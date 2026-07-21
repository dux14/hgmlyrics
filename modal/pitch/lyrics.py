# modal/pitch/lyrics.py
"""Nodo GPU de hkn-pitch: transcribe la letra de la voz lead con WhisperX
(timestamps por palabra) y la silaba con pyphen. NO importa modal/sections/
(dominio propio)."""
from __future__ import annotations
import io
import json

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key

PAUSE_THRESHOLD_S = 0.6


def run_lyrics(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes) -> list:
    """
    Nodo GPU de la fase 'lyrics'. Transcribe lead_bytes (WAV) con WhisperX
    (word-level timestamps, es/en autodetectado), silaba cada palabra con
    pyphen y agrupa en lineas (pausa entre palabras > 0.6s = nueva linea).
    Sube lyrics/words.json y postea el webhook 'lyrics'. Devuelve
    lines_words -- lista de lineas, cada linea es una lista PLANA de silabas
    {"text","start","end"} -- para fusion.py (fuse_syllables_notes itera cada
    linea como lista plana de dicts de silaba).

    En fallo: post_webhook(..., {"ok": False, "error": str(exc)[:400]}) y
    re-lanza (run_pipeline decide la cascada).
    """
    try:
        import tempfile

        import pyphen
        import torch
        import whisperx

        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"

        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            tmp.write(io.BytesIO(lead_bytes).read())
            tmp.flush()

            model = whisperx.load_model("large-v3", device, compute_type=compute_type)
            audio = whisperx.load_audio(tmp.name)
            result = model.transcribe(audio, batch_size=16)

            language = result["language"]
            # El catalogo (Hakuna) es es/en; WhisperX a veces detecta lenguas
            # cercanas al espanol (ca/gl/pt) en audio musical corto. Eso no solo
            # rompe el align model de esas lenguas: la propia TRANSCRIPCION sale
            # degradada (texto en catalan/gallego para un tema en espanol). Si el
            # idioma auto-detectado no es es/en, forzamos es y RE-transcribimos con
            # ese idioma (no basta clampear el align: el texto ya vendria mal).
            if language not in ("es", "en"):
                language = "es"
                result = model.transcribe(audio, batch_size=16, language=language)
            align_model, meta = whisperx.load_align_model(language_code=language, device=device)
            aligned = whisperx.align(result["segments"], align_model, meta, audio, device)

        dic_lang = "es_ES" if language == "es" else "en_US"
        dic = pyphen.Pyphen(lang=dic_lang)

        lines_words: list = []
        current_line: list = []
        prev_end = None

        for segment in aligned["segments"]:
            for word in segment.get("words", []):
                start = word.get("start")
                end = word.get("end")
                text = (word.get("word") or "").strip()
                if not text or start is None or end is None:
                    continue  # palabra sin timestamp (WhisperX a veces no alinea puntuacion/ruido)

                if prev_end is not None and start - prev_end > PAUSE_THRESHOLD_S and current_line:
                    lines_words.append(current_line)
                    current_line = []

                syllables_text = dic.inserted(text).split("-") or [text]
                n = len(syllables_text)
                span = (end - start) / n
                for i, syl_text in enumerate(syllables_text):
                    # reparto uniforme del intervalo [start,end] entre silabas;
                    # posible refinamiento M2: proporcional a energia RMS
                    syl_start = start + i * span
                    syl_end = start + (i + 1) * span
                    current_line.append({"text": syl_text, "start": syl_start, "end": syl_end})

                prev_end = end

        if current_line:
            lines_words.append(current_line)

        data = json.dumps(lines_words, ensure_ascii=False).encode("utf-8")
        put_url = request_signed_put(sign_upload_url, inbound_secret, job_id, "lyrics/words.json")
        upload_put(put_url, data, content_type="application/json")
        key = extract_storage_key(put_url)

        post_webhook(webhook, job_id, "lyrics", {
            "ok": True,
            "artifacts": [artifact("lyrics_words", key, "application/json")],
        })
    except Exception as exc:
        post_webhook(webhook, job_id, "lyrics", {"ok": False, "error": str(exc)[:400]})
        raise

    return lines_words
