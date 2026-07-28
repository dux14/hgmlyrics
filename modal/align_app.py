# modal/align_app.py
"""
Orquestador de forced alignment (WhisperX es) — Vista inmersiva karaoke.

Pipeline de una sola funcion GPU:
  1. Descargar el audio completo de la cancion (audioUrl firmada por Vercel),
     una sola vez (_download_audio).
  2. Beat-tracking con librosa sobre esa mezcla completa (_detect_beats),
     best-effort: nunca tumba el pipeline, None si no detecta nada usable.
  3. Extraer el stem vocal con BS-RoFormer ep_317 desde el mismo archivo ya
     descargado (_extract_vocals_from_path, mismo helper que usan S3/S4 del
     Estudio de pistas — ver sections/_common.py).
  4. WhisperX: alinear (NO transcribir) el texto CONOCIDO de las lineas contra
     el audio vocal, con el modelo de alineado en espanol.
  5. align_mapping.map_words_to_lines: mapear las palabras alineadas (con su
     timestamp) a las lineas de entrada -> [{i, startMs}, ...].
  6. POST firmado al webhookUrl con el resultado (o el error, en cualquier
     excepcion — nunca silencio).

Contrato de entrada (payload que postea api/_lib/align.js):
  { songId, audioUrl, lines: [{i, text}], webhookUrl, snapshotHash? }

Contrato de salida (webhook, ver api/align/webhook.js):
  exito: { songId, lines: [{i, startMs}, ...], provider: 'whisperx',
           beats: { bpm, beatsMs: [int, ...] } | null, snapshotHash? }
  error: { songId, error: str, snapshotHash? }

snapshotHash es opcional: solo viaja cuando dispatchAlign lo recibe (fase
`sync` del pipeline unificado, guarda anti-zombie de process.js). Karaoke
standalone no lo manda -- se echa de vuelta tal cual (None si no vino).

`beats` sale de un beat-tracking con librosa sobre la MEZCLA completa
(best-effort: None si la deteccion no es usable, nunca tumba el pipeline).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time

from fastapi import Header, HTTPException
import modal

from align_mapping import map_words_to_lines
from sections._common import _extract_vocals_from_path
from transcribe_diff import line_scores

app = modal.App("hkn-align")

# Imagen: la misma base que stems_app (demucs/audio-separator ya instalados
# para extract_vocals_stem) + whisperx para el alineado forzado en espanol.
# Modal 1.x no auto-monta modulos locales hermanos: hay que incluir
# explicitamente `sections` y `align_mapping`.
#
# whisperx PINEADO a 3.3.1 — NO ACTUALIZAR A CIEGAS. Es la ultima version
# compatible con el resto del stack de la imagen (torch==2.4.1 de
# requirements.txt + audio-separator==0.28.5, que exige torch<2.5 y
# numpy<2): whisperx>=3.3.4 ya sube su pin a torch>=2.5.1, y whisperx 3.7.x
# (la ultima en PyPI) exige torch~=2.8.0 y numpy>=2.0.2 — un `modal deploy`
# con esa version falla con ResolutionImpossible porque no hay forma de
# satisfacer ambos stacks a la vez. 3.3.1 declara torch>=2 / torchaudio>=2
# (sin tope) y pyannote.audio==3.3.2 (identico al pin de requirements.txt),
# asi que no hay conflicto. Se instala en el MISMO comando que repite los
# pins de torch/torchaudio para que el resolver no los mueva igual.
# Verificado (pip download --no-deps whisperx==3.3.1): load_align_model
# (language_code, device), align(transcript, model, metadata, audio,
# device) y load_audio(file) tienen la misma firma que se usa mas abajo.
align_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install_from_requirements("requirements.txt")
    .pip_install("whisperx==3.3.1", "torch==2.4.1", "torchaudio==2.4.1", "ctc-forced-aligner")
    # jiwer: CER por linea para el gate de letra (transcribe_diff.line_scores),
    # sin pines de torch/numpy propios -- no interfiere con el resto de la imagen.
    .pip_install("jiwer==3.0.4")
    # ctranslate2 4.5.0 es la primera linea construida contra cuDNN 9 (las
    # <=4.4.0 buscan libcudnn_ops_infer.so.8). torch==2.4.1 ya bundlea cuDNN 9
    # (nvidia-cudnn-cu12 9.1.x), asi que reusamos ESE cuDNN en vez de instalar
    # un segundo (instalar cuDNN 8 romperia el cuDNN 9 que necesita whisperx.align
    # en run_align/karaoke -> prod). Rango permitido por faster-whisper (<5).
    # Sin esto, run_transcribe (model.transcribe -> faster-whisper -> ctranslate2)
    # crashea con SIGABRT (exit 134) al no encontrar cuDNN 8, y como es SIGABRT
    # (no excepcion Python) el except no postea webhook -> fase transcription
    # queda huerfana en 'running'. run_align (forced-align wav2vec2) no toca
    # ctranslate2, por eso karaoke nunca vio este crash.
    .pip_install("ctranslate2==4.5.0")
    # ctranslate2 hace dlopen de cuDNN en runtime y NO busca en site-packages
    # de torch por defecto: hay que ponerlo en LD_LIBRARY_PATH explicitamente.
    .env(
        {
            "LD_LIBRARY_PATH": "/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib:/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib"
        }
    )
    .add_local_python_source("sections")
    .add_local_python_source("align_mapping")
    .add_local_python_source("transcribe_diff")
)

# Imagen de los ENDPOINTS HTTP (start/transcribe). Solo validan el payload y
# hacen `.spawn()` de la funcion GPU, asi que no necesitan nada de align_image:
# con la imagen pesada, un endpoint frio tardaba mas de 8s solo en levantar
# (torch/whisperx), el POST de dispatch de Vercel abortaba por timeout y la fase
# quedaba 'failed' mientras la GPU ya estaba procesando -- trabajo pagado y
# tirado (incidente 27-jul-2026, fase transcription). Con la imagen liviana el
# cold start del endpoint baja al orden del segundo.
#
# Que lleva y por que: fastapi para el decorador de endpoint, y jiwer porque
# align_app importa `transcribe_diff.line_scores` a nivel de MODULO y ese modulo
# importa jiwer -- el contenedor del endpoint carga el archivo entero aunque
# solo ejecute start/transcribe. Los tres add_local_python_source son los mismos
# de align_image por la misma razon: el import global tiene que resolver.
# `sections/_common.py` no importa nada pesado a nivel de modulo (httpx y el
# stack de audio van DENTRO de sus funciones), asi que no arrastra la imagen.
dispatch_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]", "jiwer==3.0.4")
    .add_local_python_source("sections")
    .add_local_python_source("align_mapping")
    .add_local_python_source("transcribe_diff")
)

# hkn-webhook trae MODAL_INBOUND_SECRET (auth del endpoint web) y
# MODAL_WEBHOOK_SECRET (firma del POST de salida) — mismo secret que stems_app.
_webhook_secrets = [modal.Secret.from_name("hkn-webhook")]


# ──────────────────────────────────────────────────────────────────────────────
# Webhook de salida
# ──────────────────────────────────────────────────────────────────────────────

# Igual que sections/extract.py:216 (`error=str(exc)[:400]`): tope de tamano
# para el mensaje de error que se persiste en DB.
_ERROR_MSG_MAX_LEN = 400

# Redacta query strings completos (p.ej. el token de un signed URL de
# Supabase Storage en audioUrl) antes de truncar. Un httpx.HTTPStatusError al
# descargar audioUrl incluye la URL completa en su mensaje, y esa URL trae un
# token bearer en el query string — no debe acabar persistido en DB ni en logs.
_QUERY_STRING_RE = re.compile(r"\?[^\s]*")


def _sanitize_error_message(exc: BaseException) -> str:
    """Mensaje de error seguro para postear/persistir: redacta cualquier query
    string (credenciales de signed URLs) y trunca a _ERROR_MSG_MAX_LEN."""
    msg = _QUERY_STRING_RE.sub("?[redacted]", str(exc))
    return msg[:_ERROR_MSG_MAX_LEN]


def _post_align_webhook(webhook_url: str, body: dict) -> None:
    """
    Postea el resultado (o error) del alineado a `webhook_url` con la MISMA
    firma HMAC que post_webhook de sections/_common.py (comparte contrato con
    verifyModalSignature en api/_lib/modal.js), pero con el shape de payload
    propio de align (songId/lines/provider, no jobId/section/result).

    Serializa el body con json.dumps UNA sola vez; firma y envia ese mismo
    string exacto. El secret sale de MODAL_WEBHOOK_SECRET (secret Modal
    hkn-webhook), NO del payload de entrada (align.js no lo manda).

    Reintenta UNA vez (con un backoff corto) si el POST falla: un webhook
    fallido por un timeout/hipo de red transitorio no debe dejar
    song_line_timings colgado en 'processing' si el reintento hubiera
    bastado.
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
        time.sleep(2)  # backoff corto antes del unico reintento
        r = httpx.post(webhook_url, content=body_str, headers=headers, timeout=30)
        r.raise_for_status()


# ──────────────────────────────────────────────────────────────────────────────
# Beat-tracking (librosa, best-effort)
# ──────────────────────────────────────────────────────────────────────────────

_MIN_BEATS = 8


def _beats_payload(raw: dict | None) -> dict | None:
    """Normaliza el resultado del beat-tracking; None si no es usable
    (best-effort: pocos beats detectados o bpm invalido)."""
    if not raw or not raw.get("beatsMs") or len(raw["beatsMs"]) < _MIN_BEATS:
        return None
    bpm = float(raw.get("bpm") or 0)
    if bpm <= 0:
        return None
    return {"bpm": round(bpm, 2), "beatsMs": [int(t) for t in raw["beatsMs"]]}


def _detect_beats(audio_path: str) -> dict | None:
    """Beat-tracking con librosa sobre la MEZCLA completa (no el stem
    vocal). Best-effort: cualquier excepcion devuelve None y el alignment
    sigue — el metronomo es una feature aparte, nunca debe tumbar el
    forced alignment."""
    try:
        import numpy as np
        import librosa  # solo disponible dentro del contenedor Modal

        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        tempo, beat_times = librosa.beat.beat_track(y=y, sr=sr, units="time")
        bpm = float(np.atleast_1d(tempo)[0])
        return _beats_payload({"bpm": bpm, "beatsMs": [int(t * 1000) for t in beat_times]})
    except Exception as exc:
        print(f"beat-tracking fallo (no fatal): {exc}")
        return None


def _download_audio(get_url: str) -> str:
    """Descarga el audio original (la mezcla completa) a un archivo local
    temporal. Mismo patron que extract_vocals_stem (sections/_common.py) —
    se duplica aqui, en vez de modificar _common.py, para descargar UNA
    sola vez: el beat-tracking corre sobre este archivo (la mezcla), y
    despues se pasa a _extract_vocals_from_path para obtener el stem vocal
    sin volver a descargar."""
    import os
    import tempfile

    import httpx  # solo disponible dentro del contenedor Modal

    fd, src_path = tempfile.mkstemp(suffix=".audio")
    os.close(fd)
    with httpx.stream("GET", get_url, timeout=120, follow_redirects=True) as r:
        r.raise_for_status()
        with open(src_path, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return src_path


# ──────────────────────────────────────────────────────────────────────────────
# Pipeline principal (GPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=align_image, secrets=_webhook_secrets, gpu="T4", timeout=900)
def run_align(payload: dict) -> None:
    """
    payload: { songId, audioUrl, lines: [{i,text}], webhookUrl, snapshotHash? }

    En CUALQUIER excepcion postea { songId, error: str(e), snapshotHash? } al
    webhook — nunca deja el pedido de Vercel esperando en silencio
    (song_line_timings quedaria 'processing' para siempre si no se notifica).

    snapshotHash es opcional (fase `sync` del pipeline unificado, plan C /
    guarda anti-zombie de process.js): si viene en el payload se echa de
    vuelta tal cual en el webhook de salida, exito o error. Karaoke standalone
    no lo manda -- queda None y el shape del body no cambia observablemente.
    """
    song_id = payload.get("songId")
    webhook_url = payload.get("webhookUrl")
    audio_url = payload.get("audioUrl")
    lines: list[dict] = payload.get("lines") or []
    snapshot_hash = payload.get("snapshotHash")

    try:
        if not song_id or not webhook_url:
            raise ValueError("payload invalido: faltan songId/webhookUrl")
        if not audio_url:
            raise ValueError("payload invalido: falta audioUrl")
        if not lines:
            raise ValueError("payload invalido: lines vacio")

        # ── 1+2. Descargar audio (una sola vez) + extraer stem vocal ────────
        audio_path = _download_audio(audio_url)
        # Beat-tracking sobre la MEZCLA completa, no el stem vocal. Best-
        # effort: nunca lanza, None si la deteccion no es usable.
        beats = _detect_beats(audio_path)
        vocals_path = _extract_vocals_from_path(audio_path)

        # ── 3. Alinear el texto CONOCIDO (no transcripcion libre) ───────────
        # Motor seleccionable por flag ALIGN_ENGINE (default whisperx). Los
        # imports pesados de cada motor van DENTRO de su rama: whisperx solo
        # existe en la imagen Modal (no en el entorno local que evalua este
        # modulo durante `modal deploy`), y ctc-forced-aligner no esta
        # instalado localmente (por eso los tests CPU no lo ejercitan).
        texto_completo = " ".join(line.get("text", "") for line in lines)

        engine = os.environ.get("ALIGN_ENGINE", "whisperx")
        if engine == "ctc":
            import torch
            from ctc_forced_aligner import (
                load_alignment_model, generate_emissions, preprocess_text,
                get_alignments, get_spans, postprocess_results, load_audio,
            )
            from align_ctc_adapter import ctc_words_to_whisperx_segments

            device = "cuda" if torch.cuda.is_available() else "cpu"
            model, tokenizer = load_alignment_model(
                device, dtype=torch.float16 if device == "cuda" else torch.float32
            )
            audio_wav = load_audio(vocals_path, model.dtype, model.device)
            emissions, stride = generate_emissions(model, audio_wav, batch_size=8)
            tokens_starred, text_starred = preprocess_text(
                texto_completo, romanize=True, language="spa"
            )
            segments_ctc, scores, blank_token = get_alignments(emissions, tokens_starred, tokenizer)
            spans = get_spans(tokens_starred, segments_ctc, blank_token)
            word_timestamps = postprocess_results(text_starred, spans, stride, scores)
            aligned_segments = ctc_words_to_whisperx_segments(word_timestamps)
        else:
            import whisperx

            audio = whisperx.load_audio(vocals_path)
            duration_sec = len(audio) / 16000.0
            segments = [{"text": texto_completo, "start": 0.0, "end": duration_sec}]
            align_model, metadata = whisperx.load_align_model(language_code="es", device="cuda")
            result = whisperx.align(segments, align_model, metadata, audio, "cuda")
            aligned_segments = result.get("segments", [])

        words: list[dict] = []
        for segment in aligned_segments:
            words.extend(segment.get("words", []))

        # ── 4. Mapear palabras alineadas -> lineas ──────────────────────────
        mapped_lines = map_words_to_lines(lines, words)

        # ── 5. Webhook de exito ──────────────────────────────────────────────
        _post_align_webhook(
            webhook_url,
            {
                "songId": song_id,
                "lines": mapped_lines,
                "provider": "whisperx",
                "beats": beats,
                "snapshotHash": snapshot_hash,
            },
        )
    except Exception as e:  # noqa: BLE001 — cualquier excepcion se reporta, nunca se silencia
        if webhook_url:
            try:
                _post_align_webhook(
                    webhook_url,
                    {
                        "songId": song_id,
                        "error": _sanitize_error_message(e),
                        "snapshotHash": snapshot_hash,
                    },
                )
            except Exception:
                pass  # el webhook de error tambien puede fallar (red); no hay mas fallback
        raise


# ──────────────────────────────────────────────────────────────────────────────
# Web endpoint — recibe la invocacion de Vercel (patron `start` de stems_app)
# ──────────────────────────────────────────────────────────────────────────────

def _validate_align_payload(payload: dict) -> str | None:
    """Valida el payload ANTES de lanzar run_align. Devuelve un mensaje de
    error (string) si falta algo requerido, o None si es valido.

    Un dispatch malformado (bug del caller, payload truncado, etc.) que
    pasara igual no dejaria rastro hasta que el contenedor GPU arrancara y
    fallara adentro — mientras tanto song_line_timings queda colgado en
    'processing'. Validar aqui, antes del .spawn(), evita crear ese job GPU
    huerfano: el caller (api/_lib/align.js) recibe un 400 inmediato y puede
    marcar failed sin esperar nada."""
    if not payload.get("songId"):
        return "falta songId"
    if not payload.get("audioUrl"):
        return "falta audioUrl"
    if not payload.get("webhookUrl"):
        return "falta webhookUrl"
    if not payload.get("lines"):
        return "lines vacio o ausente"
    return None


@app.function(image=dispatch_image, secrets=_webhook_secrets)
@modal.fastapi_endpoint(method="POST")
def start(payload: dict, x_inbound_secret: str = Header(default="")):
    """
    Punto de entrada HTTP. Verifica `x-inbound-secret` contra
    MODAL_INBOUND_SECRET, valida el payload (400 si falta algo requerido) y
    lanza run_align de forma asincrona (.spawn), devolviendo el callId de
    inmediato para no bloquear el request de Vercel.

    Respuesta: { "callId": "<modal call object_id>" }
    """
    if not hmac.compare_digest(
        x_inbound_secret,
        os.environ.get("MODAL_INBOUND_SECRET", ""),
    ):
        raise HTTPException(status_code=401, detail="bad inbound secret")

    validation_error = _validate_align_payload(payload)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    call = run_align.spawn(payload)
    return {"callId": call.object_id}


# ──────────────────────────────────────────────────────────────────────────────
# Smoke local (requiere credenciales/mp3 reales; NO corre en CI)
# ──────────────────────────────────────────────────────────────────────────────

def _validate_transcribe_payload(payload: dict) -> str | None:
    """Misma logica que _validate_align_payload, adaptada al contrato de
    transcribe: { vocalsGetUrl, dbLines?, canonicalLines?, runId, webhookUrl,
    snapshotHash? }. dbLines, canonicalLines y snapshotHash son opcionales:
    el caso de uso central del pipeline es una cancion SIN letra todavia (la
    transcripcion es verbatim, no necesita referencia contra la que comparar) --
    exigir dbLines no vacio rechazaba con 400 justo el caso que esta fase existe
    para resolver."""
    if not payload.get("runId"):
        return "falta runId"
    if not payload.get("vocalsGetUrl"):
        return "falta vocalsGetUrl"
    if not payload.get("webhookUrl"):
        return "falta webhookUrl"
    return None


@app.function(image=align_image, secrets=_webhook_secrets, gpu="T4", timeout=600)
def run_transcribe(payload: dict) -> None:
    """
    payload: { vocalsGetUrl, dbLines: [str], canonicalLines?: [str], runId,
    webhookUrl, snapshotHash? }

    Transcripcion VERBATIM (texto libre, SIN pasarle la letra conocida —
    a diferencia de run_align, que hace forced alignment del texto ya sabido).
    Sirve de gate: compara lo cantado contra la letra en DB (y la canonica, si
    llega) linea a linea con jiwer, para detectar drift/erratas antes de
    publicar. En CUALQUIER excepcion postea { runId, phase: 'transcription',
    ok: False, error } al webhook — nunca deja el run esperando en silencio.
    """
    run_id = payload.get("runId")
    webhook_url = payload.get("webhookUrl")
    vocals_get_url = payload.get("vocalsGetUrl")
    db_lines: list[str] = payload.get("dbLines") or []
    snapshot_hash = payload.get("snapshotHash")

    try:
        if not run_id or not webhook_url:
            raise ValueError("payload invalido: faltan runId/webhookUrl")
        if not vocals_get_url:
            raise ValueError("payload invalido: falta vocalsGetUrl")
        # dbLines es opcional (ver _validate_transcribe_payload): sin letra
        # aun en songs.sections, line_scores mas abajo degrada a perLine: [].

        import whisperx

        # El stem vocal ya viene separado (a diferencia de run_align, que lo
        # extrae el mismo del audio completo): aqui solo se descarga y se
        # transcribe, no hay beat-tracking ni extraccion de voces.
        vocals_path = _download_audio(vocals_get_url)

        device = "cuda"
        model = whisperx.load_model("large-v3", device, compute_type="float16")
        audio = whisperx.load_audio(vocals_path)
        result = model.transcribe(audio, batch_size=16)

        # Clamp de idioma es/en igual que modal/pitch/lyrics.py: el catalogo es
        # es/en, y WhisperX a veces detecta lenguas cercanas (ca/gl/pt) en
        # audio musical corto -- eso degrada tambien la propia transcripcion,
        # no solo el align model, asi que forzamos es y RE-transcribimos.
        language = result.get("language")
        if language not in ("es", "en"):
            language = "es"
            result = model.transcribe(audio, batch_size=16, language=language)

        align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
        aligned = whisperx.align(result["segments"], align_model, metadata, audio, device)

        words: list[dict] = []
        trans_lines: list[str] = []
        full_text_parts: list[str] = []
        for segment in aligned.get("segments", []):
            seg_text = (segment.get("text") or "").strip()
            if seg_text:
                trans_lines.append(seg_text)
                full_text_parts.append(seg_text)
            for word in segment.get("words", []):
                start = word.get("start")
                end = word.get("end")
                if start is None or end is None:
                    continue  # palabra sin timestamp (igual que lyrics.py)
                words.append({
                    "word": word.get("word"),
                    "startMs": int(start * 1000),
                    "endMs": int(end * 1000),
                    "score": word.get("score"),
                })

        # Sin dbLines (cancion sin letra todavia) no hay contra que comparar:
        # degrada a perLine vacio en vez de invocar jiwer con la referencia vacia.
        per_line = line_scores(trans_lines, db_lines) if db_lines else []

        payload_out = {
            "text": " ".join(full_text_parts),
            "words": words,
            "perLine": per_line,
            # transLines: el texto transcrito linea a linea (segmentos). El gate
            # de letra (plan C) lo necesita para poblar sources.trans y derivar
            # vocalizaciones (segmentos sin match en DB). Sin esto, buildReviewDoc
            # degrada a sources.trans=null y sin vocalizaciones en runs reales.
            "transLines": trans_lines,
        }

        _post_align_webhook(
            webhook_url,
            {
                "runId": run_id,
                "phase": "transcription",
                "ok": True,
                "snapshotHash": snapshot_hash,
                "payload": payload_out,
            },
        )
    except Exception as e:  # noqa: BLE001 — cualquier excepcion se reporta, nunca se silencia
        if webhook_url:
            try:
                _post_align_webhook(
                    webhook_url,
                    {
                        "runId": run_id,
                        "phase": "transcription",
                        "ok": False,
                        "error": _sanitize_error_message(e),
                    },
                )
            except Exception:
                pass  # el webhook de error tambien puede fallar (red); no hay mas fallback
        raise


@app.function(image=dispatch_image, secrets=_webhook_secrets)
@modal.fastapi_endpoint(method="POST")
def transcribe(payload: dict, x_inbound_secret: str = Header(default="")):
    """
    Punto de entrada HTTP del gate de letra. Mismo patron que `start` (arriba):
    verifica x-inbound-secret, valida el payload y lanza run_transcribe async.

    Respuesta: { "callId": "<modal call object_id>" }
    """
    if not hmac.compare_digest(
        x_inbound_secret,
        os.environ.get("MODAL_INBOUND_SECRET", ""),
    ):
        raise HTTPException(status_code=401, detail="bad inbound secret")

    validation_error = _validate_transcribe_payload(payload)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    call = run_transcribe.spawn(payload)
    return {"callId": call.object_id}


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
