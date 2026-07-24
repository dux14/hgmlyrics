# modal/pitch/lyrics.py
"""Nodo GPU de hkn-pitch: transcribe la letra de la voz lead con WhisperX
(timestamps por palabra) y la silaba con pyphen. NO importa modal/sections/
(dominio propio)."""
from __future__ import annotations
import io
import json

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key

PAUSE_THRESHOLD_S = 0.6


def _resolve_word_timings(words: list, line_start: float, line_end: float) -> list:
    """Devuelve una tupla (start, end, score) por palabra de `words`, en el mismo
    orden. Las palabras sin timestamp (align no las ubico) se interpolan dentro
    del hueco entre sus vecinas alineadas de la misma linea; si NINGUNA palabra
    de la linea tiene timestamp, se reparten uniformemente dentro de
    [line_start, line_end]."""
    n = len(words)
    if n == 0:
        return []

    resolved = [None] * n
    for i, word in enumerate(words):
        start, end = word.get("start"), word.get("end")
        if start is not None and end is not None:
            resolved[i] = (start, end, word.get("score"))

    if all(r is None for r in resolved):
        span = (line_end - line_start) / n
        return [(line_start + i * span, line_start + (i + 1) * span, None) for i in range(n)]

    i = 0
    while i < n:
        if resolved[i] is not None:
            i += 1
            continue
        j = i
        while j < n and resolved[j] is None:
            j += 1
        gap_start = resolved[i - 1][1] if i > 0 else line_start
        gap_end = resolved[j][0] if j < n else line_end
        count = j - i
        span = (gap_end - gap_start) / count
        for k in range(count):
            resolved[i + k] = (gap_start + k * span, gap_start + (k + 1) * span, None)
        i = j

    return resolved


def _syllabize_word(text: str, start: float, end: float, dic, score=None) -> list:
    syllables_text = dic.inserted(text).split("-") or [text]
    n = len(syllables_text)
    span = (end - start) / n
    out = []
    for i, syl_text in enumerate(syllables_text):
        # reparto uniforme del intervalo [start,end] entre silabas;
        # posible refinamiento M2: proporcional a energia RMS
        syl_start = start + i * span
        syl_end = start + (i + 1) * span
        syl = {"text": syl_text, "start": syl_start, "end": syl_end}
        if score is not None:
            syl["score"] = score
        out.append(syl)
    return out


def _lines_words_from_given_lines(aligned: dict, lines: list, dic) -> list:
    """Modo letra dada: un renglon de `lines_words` por cada `lines[i]`, en el
    mismo orden, sin agrupado por pausa (los renglones ya los decidio el
    admin)."""
    segments = aligned.get("segments") or []
    lines_words: list = []

    for idx, line in enumerate(lines):
        line_start = (line.get("startMs") or 0) / 1000
        line_end = (line.get("endMs") or 0) / 1000
        words = (segments[idx].get("words") or []) if idx < len(segments) else []
        timings = _resolve_word_timings(words, line_start, line_end)

        current_line: list = []
        for word, (w_start, w_end, score) in zip(words, timings):
            text = (word.get("word") or "").strip()
            if not text:
                continue
            current_line.extend(_syllabize_word(text, w_start, w_end, dic, score=score))
        lines_words.append(current_line)

    return lines_words


def _lines_words_from_transcription(aligned: dict, dic) -> list:
    """Modo actual (sin `lines`): agrupa por pausa entre palabras."""
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

            current_line.extend(_syllabize_word(text, start, end, dic))
            prev_end = end

    if current_line:
        lines_words.append(current_line)

    return lines_words


def run_lyrics(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes, lines=None, language=None) -> list:
    """
    Nodo GPU de la fase 'lyrics'.

    Sin `lines` (comportamiento historico): transcribe lead_bytes (WAV) con
    WhisperX (word-level timestamps, es/en autodetectado), silaba cada palabra
    con pyphen y agrupa en lineas (pausa entre palabras > 0.6s = nueva linea).

    Con `lines` (letra ya aprobada en el gate, [{"text","startMs","endMs"}, ...]
    en orden de documento): NO transcribe. Corre forced align (whisperx.align)
    sobre el texto dado, acotado por linea a [startMs/1000, endMs/1000]. Cada
    entrada de `lines` produce exactamente una entrada de `lines_words`, en el
    mismo orden -- PAUSE_THRESHOLD_S no aplica en este modo. `language`
    ("es"|"en") viene del gate; sin dato, default "es".

    Sube lyrics/words.json y postea el webhook 'lyrics'. Devuelve
    lines_words -- lista de lineas, cada linea es una lista PLANA de silabas
    {"text","start","end","score"} -- para fusion.py (fuse_syllables_notes
    itera cada linea como lista plana de dicts de silaba).

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
            audio = whisperx.load_audio(tmp.name)

            if lines:
                language = language or "es"
                align_model, meta = whisperx.load_align_model(language_code=language, device=device)
                segments = [
                    {
                        "text": line.get("text") or "",
                        "start": (line.get("startMs") or 0) / 1000,
                        "end": (line.get("endMs") or 0) / 1000,
                    }
                    for line in lines
                ]
                aligned = whisperx.align(segments, align_model, meta, audio, device)
            else:
                model = whisperx.load_model("large-v3", device, compute_type=compute_type)
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

        if lines:
            lines_words = _lines_words_from_given_lines(aligned, lines, dic)
        else:
            lines_words = _lines_words_from_transcription(aligned, dic)

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
