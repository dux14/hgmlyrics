# modal/pitch/pitch_app.py
"""Orquestador DAG de hkn-pitch (M1). Fases (REQUIRED_PHASES, siempre reportan):
separation,f0,notes,lyrics,fusion,render. Secuencial: cada fase recibe el
resultado en memoria de la anterior via .remote(). Cascada: si una fase falla,
postea ok:false para las restantes no ejecutadas (no deja el job colgado hasta
el cron). Idempotencia por jobId (modal.Dict) para que el reintento de approve
(~16s) no lance 2 corridas GPU facturadas."""
from __future__ import annotations
import hmac, os
from fastapi import Header, HTTPException
import modal
from _common import download_bytes, post_webhook
from separation import run_separation
from f0 import run_f0
from notes import run_notes
from lyrics import run_lyrics
from fusion import run_fusion
from render import run_render

REQUIRED_PHASES = ["separation", "f0", "notes", "lyrics", "fusion", "render"]
app = modal.App("hkn-pitch")

# Imagen GPU: separation (BS-RoFormer via audio-separator + MedleyVox via asteroid),
# f0 (torchcrepe), lyrics (WhisperX). SIN clones (torchcrepe reemplaza RMVPE;
# MedleyVox se corre via asteroid directo).
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install_from_requirements("requirements.txt")
    .add_local_python_source(
        "core", "_common", "separation", "f0", "notes", "lyrics", "fusion", "render"
    )
)
# Imagen CPU liviana para notes/fusion (core.py + numpy/httpx): no paga GPU.
# Monta la lista COMPLETA de módulos: Modal 1.x no auto-monta los hermanos y al
# arrancar un contenedor cpu_image Modal importa pitch_app.py, que hace
# `from separation/f0/lyrics import ...` a nivel de módulo — sin estos .py el
# import falla con ModuleNotFoundError antes de correr notes/fusion.
# separation/f0/lyrics solo tienen imports baratos top-level (los pesados
# torch/whisperx/librosa son function-local), así que no encarecen la imagen CPU.
cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("numpy==1.26.4", "httpx==0.27.2")
    .add_local_python_source(
        "core", "_common", "separation", "f0", "notes", "lyrics", "fusion", "render"
    )
)
# Imagen CPU para render: igual a cpu_image + libcairo2 (cairosvg) + pretty_midi
# + music21. Aparte de cpu_image porque render es la unica fase que rasteriza
# SVG/exporta MIDI/MusicXML; el resto de fases CPU no necesitan estas deps
# nativas/pesadas. add_local_python_source va al final (mismo orden que
# cpu_image) por convencion de cacheo de capas de Modal.
render_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libcairo2")
    .pip_install("numpy==1.26.4", "httpx==0.27.2", "cairosvg==2.7.1", "pretty_midi==0.2.10", "music21==9.1.0")
    .add_local_python_source(
        "core", "_common", "separation", "f0", "notes", "lyrics", "fusion", "render"
    )
)
_secrets = [modal.Secret.from_name("pitch-hmac")]  # PITCH_MODAL_INBOUND_SECRET + PITCH_MODAL_WEBHOOK_SECRET

# Dict persistente para idempotencia por jobId (jobId -> callId del run_pipeline).
_seen = modal.Dict.from_name("pitch-jobs-seen", create_if_missing=True)


@app.function(image=image, secrets=_secrets, gpu="T4", timeout=1200)
def n_separation(job_id, webhook, sign_upload_url, inbound_secret, audio_bytes):
    return run_separation(job_id, webhook, sign_upload_url, inbound_secret, audio_bytes)


@app.function(image=image, secrets=_secrets, gpu="T4", timeout=900)
def n_f0(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes, backing_bytes):
    return run_f0(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes, backing_bytes)


@app.function(image=cpu_image, secrets=_secrets, timeout=120)
def n_notes(job_id, webhook, sign_upload_url, inbound_secret, f0_lead, f0_backing):
    return run_notes(job_id, webhook, sign_upload_url, inbound_secret, f0_lead, f0_backing)


@app.function(image=image, secrets=_secrets, gpu="T4", timeout=900)
def n_lyrics(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes):
    return run_lyrics(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes)


@app.function(image=cpu_image, secrets=_secrets, timeout=60)
def n_fusion(job_id, webhook, sign_upload_url, inbound_secret, notes_lead, notes_backing, lines_words):
    return run_fusion(job_id, webhook, sign_upload_url, inbound_secret, notes_lead, notes_backing, lines_words)


@app.function(image=render_image, secrets=_secrets, timeout=180)
def n_render(job_id, webhook, sign_upload_url, inbound_secret, analysis):
    return run_render(job_id, webhook, sign_upload_url, inbound_secret, analysis)


@app.function(image=image, secrets=_secrets, timeout=1800)
def run_pipeline(payload: dict) -> None:
    """Cadena las 6 fases con .remote() (bloqueante). En cada except, ademas de
    que el nodo ya posteo su propio ok:false, marca ok:false en las fases NO
    alcanzadas (skip_rest)."""
    job_id, webhook = payload["jobId"], payload["webhook"]  # webhook={"url":...} (Design B, sin secret)
    sign_upload_url = payload["signUploadUrl"]
    inbound_secret = os.environ["PITCH_MODAL_INBOUND_SECRET"]

    def skip_rest(from_idx: int, reason: str) -> None:
        for phase in REQUIRED_PHASES[from_idx:]:
            try:
                post_webhook(webhook, job_id, phase, {"ok": False, "error": reason})
            except Exception:
                pass

    try:
        audio_bytes = download_bytes(payload["input"]["getUrl"])
    except Exception as exc:
        skip_rest(0, f"no se pudo descargar el audio: {exc}"[:300]); return
    try:
        lead, backing = n_separation.remote(job_id, webhook, sign_upload_url, inbound_secret, audio_bytes)
    except Exception:
        skip_rest(1, "separacion fallo"); return
    try:
        f0_lead, f0_backing = n_f0.remote(job_id, webhook, sign_upload_url, inbound_secret, lead, backing)
    except Exception:
        skip_rest(2, "f0 fallo"); return
    try:
        notes_lead, notes_backing = n_notes.remote(job_id, webhook, sign_upload_url, inbound_secret, f0_lead, f0_backing)
    except Exception:
        skip_rest(3, "notas fallo"); return
    try:
        lines_words = n_lyrics.remote(job_id, webhook, sign_upload_url, inbound_secret, lead)
    except Exception:
        skip_rest(4, "letra fallo"); return
    try:
        analysis = n_fusion.remote(job_id, webhook, sign_upload_url, inbound_secret, notes_lead, notes_backing, lines_words)
    except Exception:
        skip_rest(5, "fusion fallo"); return
    try:
        n_render.remote(job_id, webhook, sign_upload_url, inbound_secret, analysis)
    except Exception:
        # render ya posteo su propio ok:false (mismo patron que fusion); como es
        # la ultima fase, aqui solo evita que la excepcion suba sin mas.
        skip_rest(5, "render fallo")


@app.function(image=image, secrets=_secrets)
@modal.fastapi_endpoint(method="POST")
def start(payload: dict, x_inbound_secret: str = Header(default="")):
    """Espeja stems_app.py::start: valida x-inbound-secret y lanza async.
    Idempotencia: si el jobId ya fue lanzado (reintento de approve ~16s), NO
    relanza (evita doble facturacion GPU) y devuelve el callId cacheado."""
    if not hmac.compare_digest(x_inbound_secret, os.environ.get("PITCH_MODAL_INBOUND_SECRET", "")):
        raise HTTPException(status_code=401, detail="bad inbound secret")
    job_id = payload.get("jobId")
    if not job_id:
        raise HTTPException(status_code=400, detail="jobId requerido")
    if job_id in _seen:
        return {"callId": _seen[job_id], "dedup": True}
    call = run_pipeline.spawn(payload)
    _seen[job_id] = call.object_id
    return {"callId": call.object_id}
