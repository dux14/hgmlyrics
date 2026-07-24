# modal/clips_app.py
"""
App `hkn-clips` — cortes por seccion (ffmpeg, CPU) para el pipeline
unificado por cancion.

Contexto: dado el snapshot aprobado de una cancion (lineas con su
startMs ya calculado por align/offset manual) y el mapeo linea->seccion
del snapshot, esta app corta cada stem (voz completa, lead, backing,
etc. — lo que venga en `stems`) en un archivo .mp3 POR SECCION, y sube
cada corte al signed PUT URL correspondiente.

SUPUESTO DE PAYLOAD (documentado aqui porque el dispatcher — Task B7 —
todavia no existe; si el shape real difiere, este modulo hay que
ajustarlo):

  {
    "runId": str,
    "webhookUrl": str,
    "snapshotHash": str | None,          # opcional, se hace echo tal cual
    "stems": [ { "kind": str, "getUrl": str }, ... ],
    "lines": [ { "i": int, "startMs": int }, ... ],   # orden = orden de canto
    "lineSections": [ int, ... ],          # mismo largo que `lines`; lineSections[k] = indice de seccion de lines[k]
    "totalMs": int,                        # duracion total de la pista (ms)
    "uploads": { "<kind>": { "<sectionIndex>": "<signed PUT url>" } },
    "uploadKeys": { "<kind>": { "<sectionIndex>": "<storage key destino>" } },
  }

`uploads` trae las URLs firmadas de subida (una por kind+seccion);
`uploadKeys` trae, en paralelo, la storage key final de cada una de esas
URLs (necesaria porque el webhook debe reportar la KEY, no la URL
firmada — y esta ultima no se puede parsear de forma generica como se
hace con `extract_storage_key` en sections/_common.py, que asume el
bucket fijo `stems-jobs`; aqui el bucket podria ser otro).
CONCERN: si B7 no manda `uploadKeys`, este modulo no puede derivar la
storage key y el clip se omite del webhook (ver `_missing_keys` abajo).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import time

from fastapi import Header, HTTPException
import modal

app = modal.App("hkn-clips")

# CPU puro: cortar con ffmpeg -c copy no necesita GPU.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    # fastapi es requerido explícitamente por @modal.fastapi_endpoint (Modal ya
    # no lo instala implícito); mismo pin que requirements.txt para no divergir
    # de las demás apps (align/stems lo traen vía pip_install_from_requirements).
    .pip_install("httpx", "fastapi[standard]==0.115.6")
)

# Mismo secret que stems_app/align_app: MODAL_INBOUND_SECRET (auth del
# endpoint) + MODAL_WEBHOOK_SECRET (firma del POST de salida).
_webhook_secrets = [modal.Secret.from_name("hkn-webhook")]


# ──────────────────────────────────────────────────────────────────────────────
# Rangos por seccion (puro, sin I/O — testeable fuera del contenedor Modal)
# ──────────────────────────────────────────────────────────────────────────────

def section_ranges(
    lines: list[dict],
    line_sections: list[int],
    total_ms: int,
) -> list[dict]:
    """
    Deriva, por cada seccion presente en `line_sections`, el rango
    [startMs, endMs) que le corresponde:
      - startMs de una seccion = startMs de su PRIMERA linea (en orden
        de aparicion en `lines`).
      - endMs de una seccion = startMs de la PRIMERA linea de la
        SIGUIENTE seccion; la ULTIMA seccion termina en `total_ms`.

    Devuelve una lista ordenada por sectionIndex de aparicion, con forma
    [{"sectionIndex": int, "startMs": int, "endMs": int}, ...].

    Robusto a listas vacias o de largo distinto (line_sections mas
    corto que lines, o viceversa): solo procesa hasta el minimo comun.
    """
    n = min(len(lines), len(line_sections))
    if n == 0:
        return []

    # Primer startMs visto por seccion, en orden de PRIMERA aparicion.
    first_start_by_section: dict[int, int] = {}
    order: list[int] = []  # orden de primera aparicion de cada sectionIndex
    for k in range(n):
        section_idx = line_sections[k]
        if section_idx not in first_start_by_section:
            first_start_by_section[section_idx] = lines[k].get("startMs", 0)
            order.append(section_idx)

    ranges: list[dict] = []
    for pos, section_idx in enumerate(order):
        start_ms = first_start_by_section[section_idx]
        if pos + 1 < len(order):
            end_ms = first_start_by_section[order[pos + 1]]
        else:
            end_ms = total_ms
        ranges.append({"sectionIndex": section_idx, "startMs": start_ms, "endMs": end_ms})

    return ranges


# ──────────────────────────────────────────────────────────────────────────────
# Webhook de salida (mismo patron HMAC que align_app._post_align_webhook)
# ──────────────────────────────────────────────────────────────────────────────

_ERROR_MSG_MAX_LEN = 400


def _post_clips_webhook(webhook_url: str, body: dict) -> None:
    """
    Postea el resultado (o error) de los cortes a `webhook_url` con la
    MISMA firma HMAC que sections/_common.post_webhook y
    align_app._post_align_webhook: `hex(hmac-sha256("{ts}.{body}"))` con
    MODAL_WEBHOOK_SECRET, headers X-Modal-Timestamp / X-Modal-Signature.

    Reintenta UNA vez ante fallo transitorio de red (mismo criterio que
    align_app._post_align_webhook). Lanza si el reintento tambien falla.
    """
    import httpx  # solo disponible dentro del contenedor Modal

    body_str = json.dumps(body)
    ts = str(int(time.time()))
    secret = os.environ.get("MODAL_WEBHOOK_SECRET", "")
    sig = hmac.new(secret.encode(), f"{ts}.{body_str}".encode(), hashlib.sha256).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "X-Modal-Timestamp": ts,
        "X-Modal-Signature": sig,
    }

    try:
        r = httpx.post(webhook_url, content=body_str, headers=headers, timeout=30)
        r.raise_for_status()
    except Exception:
        time.sleep(2)
        r = httpx.post(webhook_url, content=body_str, headers=headers, timeout=30)
        r.raise_for_status()


# ──────────────────────────────────────────────────────────────────────────────
# Descarga / corte / subida (I/O — solo corre dentro del contenedor Modal)
# ──────────────────────────────────────────────────────────────────────────────

def _download(get_url: str, suffix: str = ".audio") -> str:
    """Descarga `get_url` a un archivo local temporal; devuelve la ruta."""
    import httpx  # solo disponible dentro del contenedor Modal

    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    with httpx.stream("GET", get_url, timeout=120, follow_redirects=True) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return path


# Micro-fade en ambos bordes del clip: mata el click del padding del encoder
# sin que se perciba como atenuacion (10 ms).
CLIP_FADE_SEC = 0.010


def _cut_clip(src_path: str, start_ms: int, end_ms: int) -> str:
    """
    Corta [start_ms, end_ms) de `src_path` REENCODEANDO a mp3 192k, con
    micro-fades de 10 ms en ambos bordes.

    No se usa `-c copy` (H10 de la auditoria del 24-jul): cortar mp3 en modo
    copia alinea al frame mas cercano (~26 ms), rompe el bit reservoir de los
    primeros frames y deja los clicks del padding gapless — exactamente los
    micro-cortes que se oian en el mixer. El costo de CPU del reencode es
    despreciable frente a la separacion de stems.
    """
    fd, out_path = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    start_s = start_ms / 1000.0
    dur_s = max((end_ms - start_ms) / 1000.0, 0.001)
    # En clips muy cortos el fade no puede comerse mas de un cuarto del clip.
    fade_s = min(CLIP_FADE_SEC, dur_s / 4)
    fade_out_start = max(dur_s - fade_s, 0.0)
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start_s:.3f}",
        "-t", f"{dur_s:.3f}",
        "-i", src_path,
        "-af",
        f"afade=t=in:st=0:d={fade_s:.3f},afade=t=out:st={fade_out_start:.3f}:d={fade_s:.3f}",
        "-c:a", "libmp3lame", "-b:a", "192k",
        out_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_path


def _upload(put_url: str, file_path: str, content_type: str = "audio/mpeg") -> None:
    """HTTP PUT del clip al signed URL. Lanza en non-2xx."""
    import httpx  # solo disponible dentro del contenedor Modal

    with open(file_path, "rb") as f:
        data = f.read()
    r = httpx.put(put_url, content=data, headers={"Content-Type": content_type}, timeout=180)
    r.raise_for_status()


def _clip_duration_sec(file_path: str) -> float | None:
    """Duracion del clip via ffprobe; None si no se puede determinar
    (best-effort — no debe tumbar el corte)."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                file_path,
            ],
            check=True, capture_output=True, text=True,
        )
        return round(float(out.stdout.strip()), 3)
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────────────
# Pipeline principal (CPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, timeout=600)
def run_clips(payload: dict) -> None:
    """
    Ver el docstring del modulo para el shape asumido del payload.

    Por cada stem (`payload["stems"]`) y cada rango de seccion (derivado
    con `section_ranges`), descarga el stem UNA vez, corta un clip por
    seccion y lo sube al signed PUT URL de `uploads[kind][sectionIndex]`.
    Postea el webhook `clips` con la lista de clips subidos (o el error,
    en cualquier excepcion — nunca deja el run colgado en silencio).
    """
    run_id = payload.get("runId")
    webhook_url = payload.get("webhookUrl")
    snapshot_hash = payload.get("snapshotHash")

    try:
        if not run_id or not webhook_url:
            raise ValueError("payload invalido: faltan runId/webhookUrl")

        stems: list[dict] = payload.get("stems") or []
        lines: list[dict] = payload.get("lines") or []
        line_sections: list[int] = payload.get("lineSections") or []
        total_ms: int = payload.get("totalMs") or 0
        uploads: dict = payload.get("uploads") or {}
        upload_keys: dict = payload.get("uploadKeys") or {}

        if not stems:
            raise ValueError("payload invalido: stems vacio")

        ranges = section_ranges(lines, line_sections, total_ms)
        if not ranges:
            raise ValueError("payload invalido: no se pudieron derivar rangos de seccion")

        clips: list[dict] = []
        for stem in stems:
            kind = stem.get("kind")
            get_url = stem.get("getUrl")
            if not kind or not get_url:
                continue  # stem malformado; se salta (no tumba el resto)

            src_path = _download(get_url)
            kind_uploads = uploads.get(kind) or {}
            kind_keys = upload_keys.get(kind) or {}

            for r in ranges:
                section_idx = r["sectionIndex"]
                put_url = kind_uploads.get(str(section_idx))
                storage_key = kind_keys.get(str(section_idx))
                if not put_url or not storage_key:
                    # CONCERN (ver docstring del modulo): sin uploadKeys no
                    # hay como reportar la storage key al webhook; se omite
                    # este clip en vez de fallar todo el run.
                    continue

                clip_path = _cut_clip(src_path, r["startMs"], r["endMs"])
                _upload(put_url, clip_path)
                clips.append({
                    "sectionIndex": section_idx,
                    "voiceScope": kind,
                    "storageKey": storage_key,
                    "durationSec": _clip_duration_sec(clip_path),
                })

        _post_clips_webhook(
            webhook_url,
            {
                "runId": run_id,
                "phase": "clips",
                "ok": True,
                "snapshotHash": snapshot_hash,
                "payload": {"clips": clips},
            },
        )
    except Exception as e:  # noqa: BLE001 — cualquier excepcion se reporta, nunca se silencia
        if webhook_url:
            try:
                _post_clips_webhook(
                    webhook_url,
                    {"runId": run_id, "phase": "clips", "ok": False, "error": str(e)[:_ERROR_MSG_MAX_LEN]},
                )
            except Exception:
                pass  # el webhook de error tambien puede fallar (red); no hay mas fallback
        raise


# ──────────────────────────────────────────────────────────────────────────────
# Web endpoint — recibe la invocacion de Vercel (patron `start` de stems_app)
# ──────────────────────────────────────────────────────────────────────────────

def _validate_clips_payload(payload: dict) -> str | None:
    """Valida el payload ANTES de lanzar run_clips. Mismo criterio que
    align_app._validate_align_payload: un dispatch malformado recibe un
    400 inmediato en vez de crear un job huerfano en el contenedor."""
    if not payload.get("runId"):
        return "falta runId"
    if not payload.get("webhookUrl"):
        return "falta webhookUrl"
    if not payload.get("stems"):
        return "stems vacio o ausente"
    if not payload.get("lines"):
        return "lines vacio o ausente"
    return None


@app.function(image=image, secrets=_webhook_secrets)
@modal.fastapi_endpoint(method="POST")
def start(payload: dict, x_inbound_secret: str = Header(default="")):
    """
    Punto de entrada HTTP. Verifica `x-inbound-secret` contra
    MODAL_INBOUND_SECRET, valida el payload y lanza run_clips de forma
    asincrona (.spawn), devolviendo el callId de inmediato para no
    bloquear el request de Vercel.

    Respuesta: { "callId": "<modal call object_id>" }
    """
    if not hmac.compare_digest(
        x_inbound_secret,
        os.environ.get("MODAL_INBOUND_SECRET", ""),
    ):
        raise HTTPException(status_code=401, detail="bad inbound secret")

    validation_error = _validate_clips_payload(payload)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    call = run_clips.spawn(payload)
    return {"callId": call.object_id}
