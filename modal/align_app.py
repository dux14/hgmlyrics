# modal/align_app.py
"""
Orquestador de forced alignment (WhisperX es) — Vista inmersiva karaoke.

Pipeline de una sola funcion GPU:
  1. Descargar el audio completo de la cancion (audioUrl firmada por Vercel).
  2. Extraer el stem vocal con BS-RoFormer ep_317 (extract_vocals_stem, mismo
     helper que usan S3/S4 del Estudio de pistas — ver sections/_common.py).
  3. WhisperX: alinear (NO transcribir) el texto CONOCIDO de las lineas contra
     el audio vocal, con el modelo de alineado en espanol.
  4. align_mapping.map_words_to_lines: mapear las palabras alineadas (con su
     timestamp) a las lineas de entrada -> [{i, startMs}, ...].
  5. POST firmado al webhookUrl con el resultado (o el error, en cualquier
     excepcion — nunca silencio).

Contrato de entrada (payload que postea api/_lib/align.js):
  { songId, audioUrl, lines: [{i, text}], webhookUrl }

Contrato de salida (webhook, ver api/align/webhook.js):
  exito: { songId, lines: [{i, startMs}, ...], provider: 'whisperx' }
  error: { songId, error: str }
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time

from fastapi import Header, HTTPException
import modal

from align_mapping import map_words_to_lines
from sections._common import extract_vocals_stem

app = modal.App("hkn-align")

# Imagen: la misma base que stems_app (demucs/audio-separator ya instalados
# para extract_vocals_stem) + whisperx para el alineado forzado en espanol.
# Modal 1.x no auto-monta modulos locales hermanos: hay que incluir
# explicitamente `sections` y `align_mapping`.
align_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install_from_requirements("requirements.txt")
    .pip_install("whisperx")
    .add_local_python_source("sections")
    .add_local_python_source("align_mapping")
)

# hkn-webhook trae MODAL_INBOUND_SECRET (auth del endpoint web) y
# MODAL_WEBHOOK_SECRET (firma del POST de salida) — mismo secret que stems_app.
_webhook_secrets = [modal.Secret.from_name("hkn-webhook")]


# ──────────────────────────────────────────────────────────────────────────────
# Webhook de salida
# ──────────────────────────────────────────────────────────────────────────────

def _post_align_webhook(webhook_url: str, body: dict) -> None:
    """
    Postea el resultado (o error) del alineado a `webhook_url` con la MISMA
    firma HMAC que post_webhook de sections/_common.py (comparte contrato con
    verifyModalSignature en api/_lib/modal.js), pero con el shape de payload
    propio de align (songId/lines/provider, no jobId/section/result).

    Serializa el body con json.dumps UNA sola vez; firma y envia ese mismo
    string exacto. El secret sale de MODAL_WEBHOOK_SECRET (secret Modal
    hkn-webhook), NO del payload de entrada (align.js no lo manda).
    """
    import httpx  # solo disponible dentro del contenedor Modal

    body_str = json.dumps(body)
    ts = str(int(time.time()))
    secret = os.environ.get("MODAL_WEBHOOK_SECRET", "")
    sig = hmac.new(secret.encode(), f"{ts}.{body_str}".encode(), hashlib.sha256).hexdigest()

    r = httpx.post(
        webhook_url,
        content=body_str,
        headers={
            "Content-Type": "application/json",
            "X-Modal-Timestamp": ts,
            "X-Modal-Signature": sig,
        },
        timeout=30,
    )
    r.raise_for_status()


# ──────────────────────────────────────────────────────────────────────────────
# Pipeline principal (GPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=align_image, secrets=_webhook_secrets, gpu="T4", timeout=900)
def run_align(payload: dict) -> None:
    """
    payload: { songId, audioUrl, lines: [{i,text}], webhookUrl }

    En CUALQUIER excepcion postea { songId, error: str(e) } al webhook — nunca
    deja el pedido de Vercel esperando en silencio (song_line_timings quedaria
    'processing' para siempre si no se notifica).
    """
    song_id = payload.get("songId")
    webhook_url = payload.get("webhookUrl")
    lines: list[dict] = payload.get("lines") or []

    try:
        if not song_id or not webhook_url:
            raise ValueError("payload invalido: faltan songId/webhookUrl")
        if not lines:
            raise ValueError("payload invalido: lines vacio")

        # ── 1+2. Descargar audio + extraer stem vocal ───────────────────────
        vocals_path = extract_vocals_stem(payload["audioUrl"])

        # ── 3. WhisperX: alinear el texto CONOCIDO (no transcripcion libre) ─
        # Se importa aqui dentro (patron del repo, ver extract_vocals_stem):
        # whisperx solo existe en la imagen Modal, no en el entorno local que
        # evalua este modulo durante `modal deploy`.
        import whisperx

        audio = whisperx.load_audio(vocals_path)
        duration_sec = len(audio) / 16000.0

        texto_completo = " ".join(line.get("text", "") for line in lines)
        segments = [{"text": texto_completo, "start": 0.0, "end": duration_sec}]

        align_model, metadata = whisperx.load_align_model(language_code="es", device="cuda")
        result = whisperx.align(segments, align_model, metadata, audio, "cuda")

        words: list[dict] = []
        for segment in result.get("segments", []):
            words.extend(segment.get("words", []))

        # ── 4. Mapear palabras alineadas -> lineas ──────────────────────────
        mapped_lines = map_words_to_lines(lines, words)

        # ── 5. Webhook de exito ──────────────────────────────────────────────
        _post_align_webhook(
            webhook_url,
            {"songId": song_id, "lines": mapped_lines, "provider": "whisperx"},
        )
    except Exception as e:  # noqa: BLE001 — cualquier excepcion se reporta, nunca se silencia
        if webhook_url:
            try:
                _post_align_webhook(webhook_url, {"songId": song_id, "error": str(e)})
            except Exception:
                pass  # el webhook de error tambien puede fallar (red); no hay mas fallback
        raise


# ──────────────────────────────────────────────────────────────────────────────
# Web endpoint — recibe la invocacion de Vercel (patron `start` de stems_app)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=align_image, secrets=_webhook_secrets)
@modal.fastapi_endpoint(method="POST")
def start(payload: dict, x_inbound_secret: str = Header(default="")):
    """
    Punto de entrada HTTP. Verifica `x-inbound-secret` contra
    MODAL_INBOUND_SECRET, lanza run_align de forma asincrona (.spawn) y
    devuelve el callId de inmediato para no bloquear el request de Vercel.

    Respuesta: { "callId": "<modal call object_id>" }
    """
    if not hmac.compare_digest(
        x_inbound_secret,
        os.environ.get("MODAL_INBOUND_SECRET", ""),
    ):
        raise HTTPException(status_code=401, detail="bad inbound secret")

    call = run_align.spawn(payload)
    return {"callId": call.object_id}


# ──────────────────────────────────────────────────────────────────────────────
# Smoke local (requiere credenciales/mp3 reales; NO corre en CI)
# ──────────────────────────────────────────────────────────────────────────────

@app.local_entrypoint()
def main(audio_url: str = "", webhook_url: str = "http://localhost:3000/api/align/webhook"):
    """
    Smoke manual: `modal run align_app.py --audio-url <signed-url>`.

    Usa una letra fixture ("Santo") y un songId de prueba; postea el
    resultado al webhook indicado (por defecto, el dev server local).
    """
    if not audio_url:
        print("uso: modal run align_app.py --audio-url <mp3-firmado>")
        return

    lines = [
        {"i": 0, "text": "Sa - a - a - an - to"},
        {"i": 1, "text": "Ho sa naen el cieee lo,"},
        {"i": 2, "text": "Dioos del u ni ver sooo,"},
    ]
    payload = {
        "songId": "smoke-test-song",
        "audioUrl": audio_url,
        "lines": lines,
        "webhookUrl": webhook_url,
    }
    run_align.remote(payload)
