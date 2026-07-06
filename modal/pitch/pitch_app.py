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
from gender import run_gender
from choir_basicpitch import run_choir

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
        "core", "_common", "separation", "f0", "notes", "lyrics", "fusion", "render",
        "gender", "choir_basicpitch"
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
    # fastapi: NO lo usa notes/fusion, pero pitch_app.py hace `from fastapi import
    # Header, HTTPException` a nivel de modulo (para el endpoint `start`) y Modal
    # importa el modulo COMPLETO al bootear cualquier contenedor. Sin fastapi aqui,
    # n_notes/n_fusion crashean con ModuleNotFoundError antes de correr. Version
    # pinneada a la de requirements.txt.
    .pip_install("numpy==1.26.4", "httpx==0.27.2", "fastapi==0.115.6")
    .add_local_python_source(
        "core", "_common", "separation", "f0", "notes", "lyrics", "fusion", "render",
        "gender", "choir_basicpitch"
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
    # fastapi: idem cpu_image — pitch_app.py importa fastapi top-level para `start`,
    # y n_render (render_image) crashearia al importar el modulo sin ella.
    .pip_install("numpy==1.26.4", "httpx==0.27.2", "cairosvg==2.7.1", "pretty_midi==0.2.10", "music21==9.1.0", "fastapi==0.115.6")
    .add_local_python_source(
        "core", "_common", "separation", "f0", "notes", "lyrics", "fusion", "render",
        "gender", "choir_basicpitch"
    )
)
# Imagen AISLADA para n_choir (Basic Pitch, M5 opcional). basic-pitch[onnx]==0.4.0
# arrastra TensorFlow como dependencia DURA que chocaria con el stack
# torch/whisperx/av de la imagen GPU compartida; confinarla aqui blinda el build
# del pipeline principal. La inferencia corre por onnxruntime (CPU) — el modelo
# ICASSP es liviano, no necesita GPU. fastapi: pitch_app.py lo importa top-level
# (endpoint start) y Modal importa el modulo completo al bootear cualquier contenedor.
choir_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("numpy==1.26.4", "httpx==0.27.2", "fastapi==0.115.6", "basic-pitch[onnx]==0.4.0")
    .add_local_python_source(
        "core", "_common", "separation", "f0", "notes", "lyrics", "fusion", "render",
        "gender", "choir_basicpitch"
    )
)
# Imagen AISLADA para n_lyrics (WhisperX). faster-whisper/CTranslate2 exige cuDNN 8
# (libcudnn_ops_infer.so.8) a runtime, que debian_slim NO trae y el cuDNN 9 de torch
# no satisface -> el contenedor aborta con SIGABRT (exit 134) antes de que el except
# de lyrics.py pueda postear su fallo (por eso colgaba el job). Base nvidia/cuda con
# cuDNN 8 a nivel de sistema: CTranslate2 lo encuentra por ldconfig; torch usa su
# propio cuDNN empaquetado en su wheel. Aislada para no tocar la imagen compartida
# (separation/f0 ya verdes). Los imports top-level de los modulos montados solo
# necesitan numpy + stdlib + _common; las deps pesadas de separation/f0 son
# function-local, no hacen falta aqui.
lyrics_image = (
    modal.Image.from_registry("nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install(
        "torch==2.4.1", "torchaudio==2.4.1", "whisperx==3.3.1",
        "pyphen==0.15.0", "httpx==0.27.2", "fastapi==0.115.6", "numpy==1.26.4",
    )
    .add_local_python_source(
        "core", "_common", "separation", "f0", "notes", "lyrics", "fusion", "render",
        "gender", "choir_basicpitch"
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


# n_lyrics corre en lyrics_image AISLADA (base cuDNN 8 para CTranslate2/faster-whisper).
@app.function(image=lyrics_image, secrets=_secrets, gpu="T4", timeout=900)
def n_lyrics(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes):
    return run_lyrics(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes)


@app.function(image=cpu_image, secrets=_secrets, timeout=60)
def n_fusion(job_id, webhook, sign_upload_url, inbound_secret, notes_lead, notes_backing, lines_words, extra_voices=None):
    return run_fusion(job_id, webhook, sign_upload_url, inbound_secret, notes_lead, notes_backing, lines_words, extra_voices)


@app.function(image=render_image, secrets=_secrets, timeout=180)
def n_render(job_id, webhook, sign_upload_url, inbound_secret, analysis):
    return run_render(job_id, webhook, sign_upload_url, inbound_secret, analysis)


# Nodos OPCIONALES de M5 (flag PITCH_CHOIR). Fuera de REQUIRED_PHASES: un fallo no
# cambia succeeded/partial/failed, solo aportan voces extra a analysis.json. Corren
# sobre el stem lead ya separado (no re-descargan/re-separan).
@app.function(image=image, secrets=_secrets, gpu="T4", timeout=1200)
def n_gender(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes):
    return run_gender(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes)


# n_choir corre en choir_image AISLADA (Basic Pitch/onnx, CPU): mantiene TF fuera
# del resto del pipeline. Sin gpu: la inferencia onnx del modelo ICASSP no la necesita.
@app.function(image=choir_image, secrets=_secrets, timeout=900)
def n_choir(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes):
    return run_choir(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes)


@app.function(image=image, secrets=_secrets, timeout=1800)
def run_pipeline(payload: dict) -> None:
    """Cadena las 6 fases con .remote() (bloqueante). En cada except, marca
    ok:false desde la fase que fallo en adelante (skip_rest). Incluye la fase
    fallida a proposito: si el nodo murio duro (SIGABRT/timeout/OOM) no alcanzo a
    postear su propio ok:false, y sin esto el job quedaria colgado en running
    (nunca reporta las 6 requeridas). Si el nodo SI se auto-reporto, el re-post es
    idempotente (applyPhaseWebhook ignora un mismo estado repetido)."""
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
        skip_rest(0, "separacion fallo"); return

    # M5 (opcional): con el stem lead ya disponible, lanza genero/coro en paralelo
    # a f0/notes/lyrics. NO bloquean ni propagan error (fases opcionales fuera de
    # REQUIRED_PHASES); se recogen antes de fusion para aportar voces extra.
    choir_on = bool((payload.get("flags") or {}).get("choir", False))
    gender_call = n_gender.spawn(job_id, webhook, sign_upload_url, inbound_secret, lead) if choir_on else None
    choir_call = n_choir.spawn(job_id, webhook, sign_upload_url, inbound_secret, lead) if choir_on else None

    def cancel_optional():
        # Si una fase REQUERIDA falla y abortamos, cancela los nodos opcionales ya
        # lanzados: evita GPU huerfana (hasta 1200s) y un webhook tardio que podria
        # escribir en un job reintentado con el mismo id.
        for call in (gender_call, choir_call):
            if call is not None:
                try:
                    call.cancel()
                except Exception:
                    pass

    try:
        f0_lead, f0_backing = n_f0.remote(job_id, webhook, sign_upload_url, inbound_secret, lead, backing)
    except Exception:
        skip_rest(1, "f0 fallo"); cancel_optional(); return
    try:
        notes_lead, notes_backing = n_notes.remote(job_id, webhook, sign_upload_url, inbound_secret, f0_lead, f0_backing)
    except Exception:
        skip_rest(2, "notas fallo"); cancel_optional(); return
    try:
        lines_words = n_lyrics.remote(job_id, webhook, sign_upload_url, inbound_secret, lead)
    except Exception:
        skip_rest(3, "letra fallo"); cancel_optional(); return
    # Recoge las voces opcionales (si el flag estaba activo) antes de fusion. Un
    # nodo caido no bloquea: ya posteo su webhook y no cuenta para el estado final.
    extra_voices = {}
    for call in (gender_call, choir_call):
        if call is not None:
            try:
                extra_voices.update(call.get(timeout=900) or {})
            except Exception:
                pass
    try:
        analysis = n_fusion.remote(job_id, webhook, sign_upload_url, inbound_secret, notes_lead, notes_backing, lines_words, extra_voices)
    except Exception:
        skip_rest(4, "fusion fallo"); return
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
    relanza (evita doble facturacion GPU) y devuelve el callId cacheado.
    EXCEPCION: payload.reset=true (retry.js) fuerza un run nuevo y sobrescribe el
    cache — el retry es una accion deliberada del usuario, ya serializada por el
    CAS de retry.js (partial/failed -> running), no un doble-approve accidental.
    Sin esto, un jobId ya visto nunca podria reintentarse (quedaria como no-op)."""
    if not hmac.compare_digest(x_inbound_secret, os.environ.get("PITCH_MODAL_INBOUND_SECRET", "")):
        raise HTTPException(status_code=401, detail="bad inbound secret")
    job_id = payload.get("jobId")
    if not job_id:
        raise HTTPException(status_code=400, detail="jobId requerido")
    if not payload.get("reset") and job_id in _seen:
        return {"callId": _seen[job_id], "dedup": True}
    call = run_pipeline.spawn(payload)
    _seen[job_id] = call.object_id
    return {"callId": call.object_id}
