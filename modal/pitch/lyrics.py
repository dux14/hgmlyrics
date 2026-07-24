# modal/pitch/lyrics.py
"""Nodo GPU de hkn-pitch: transcribe la letra de la voz lead con WhisperX
(timestamps por palabra) y la silaba con pyphen. NO importa modal/sections/
(dominio propio)."""
from __future__ import annotations
import io
import json
import re
import unicodedata

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key

PAUSE_THRESHOLD_S = 0.6

# Sample rate fijo al que whisperx.load_audio resamplea (whisperx/audio.py
# SAMPLE_RATE). Se usa solo para acotar la ultima linea del modo `lines`
# contra la duracion real del audio -- ver _clamp_line_end.
AUDIO_SAMPLE_RATE = 16000


def _clamp_language(language) -> str:
    """El catalogo (Hakuna) es es/en; un valor inesperado (ausente, mal
    formado, u otro idioma que el gate no debiera mandar) se clampea a 'es'
    para no reventar load_align_model dentro de la GPU ni caer en silencio al
    diccionario en_US de pyphen. Mismo criterio que el camino de
    transcripcion (mas abajo, comentario original)."""
    return language if language in ("es", "en") else "es"


def _normalize_word(text: str) -> str:
    """minuscula, sin acentos/diacriticos, sin puntuacion -- para comparar el
    texto aprobado (con mayusculas y puntuacion) contra las words que emite
    whisperx.align (limpias, ver alignment.py clean_char)."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _resolve_gaps(timings: list, line_start: float, line_end: float) -> list:
    """timings: una entrada por token, cada una (start,end,score) o None.
    Devuelve la misma lista con los None interpolados dentro del hueco entre
    vecinos resueltos (o las cotas de linea en los bordes); si NINGUNA tiene
    timing, reparto uniforme dentro de [line_start, line_end]."""
    n = len(timings)
    if n == 0:
        return []

    lo, hi = min(line_start, line_end), max(line_start, line_end)  # cotas invertidas no deberian llegar, pero no confiar

    if all(t is None for t in timings):
        span = (hi - lo) / n
        return [(lo + i * span, lo + (i + 1) * span, None) for i in range(n)]

    resolved = list(timings)
    i = 0
    while i < n:
        if resolved[i] is not None:
            i += 1
            continue
        j = i
        while j < n and resolved[j] is None:
            j += 1
        gap_start = resolved[i - 1][1] if i > 0 else lo
        gap_end = resolved[j][0] if j < n else hi
        gap_start, gap_end = min(gap_start, gap_end), max(gap_start, gap_end)
        count = j - i
        span = (gap_end - gap_start) / count
        for k in range(count):
            resolved[i + k] = (gap_start + k * span, gap_start + (k + 1) * span, None)
        i = j

    return resolved


_MATCH_LOOKAHEAD = 2


def _match_tokens_to_words(tokens: list, words: list) -> list:
    """Empareja los tokens del texto APROBADO contra las `words` que devolvio
    el align, en orden, por texto normalizado -- nunca por posicion ciega.
    Si align dropeo un token (no esta en su diccionario), ese token no
    consume ninguna word y queda sin timing (se interpola despues); el
    puntero `wi` no avanza y se autocura solo con el proximo token. Si en
    cambio la salida del align trae una word espuria que no corresponde a
    ningun token (align dividio distinto de nuestro `tokens`), un match
    ciego contra `words[wi]` estancaria el resto de la linea entera; por eso
    ante un desencuentro se mira hasta `_MATCH_LOOKAHEAD` words mas adelante
    antes de dar el token por no alineado, saltando la word espuria."""
    timings: list = [None] * len(tokens)
    wi = 0
    for ti, tok in enumerate(tokens):
        norm_tok = _normalize_word(tok)
        if not norm_tok or wi >= len(words):
            continue
        if _normalize_word(words[wi].get("word") or "") == norm_tok:
            w = words[wi]
            if w.get("start") is not None and w.get("end") is not None:
                timings[ti] = (w["start"], w["end"], w.get("score"))
            wi += 1
            continue
        for skip in range(1, _MATCH_LOOKAHEAD + 1):
            wj = wi + skip
            if wj < len(words) and _normalize_word(words[wj].get("word") or "") == norm_tok:
                w = words[wj]
                if w.get("start") is not None and w.get("end") is not None:
                    timings[ti] = (w["start"], w["end"], w.get("score"))
                wi = wj + 1
                break
        # sin match en el lookahead: token sin timing, wi no avanza (mismo
        # tratamiento que un token dropeado por el diccionario del align)
    return timings


def _syllabize_word(text: str, start: float, end: float, dic, score=None) -> list:
    syllables_text = dic.inserted(text).split("-")
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


def _lines_words_from_given_lines(align_fn, align_model, meta, audio, device, lines: list, audio_duration: float, dic) -> list:
    """Modo letra dada: un renglon de `lines_words` por cada `lines[i]`, en el
    mismo orden, sin agrupado por pausa (los renglones ya los decidio el
    admin). El texto de cada silaba sale SIEMPRE de `lines[i]["text"]` (nunca
    de la salida del align, que llega en minuscula y sin puntuacion). Un
    align por linea: whisperx puede partir un solo segmento de entrada en
    varios subsegmentos por oracion (whisperx/alignment.py, sentence_splitter)
    -- si alinearamos todas las lineas en una sola llamada, un renglon con mas
    de una oracion correria el resto de las lineas. Con una llamada por
    linea, todos los subsegmentos que devuelva pertenecen a ESA linea."""
    lines_words: list = []

    for line in lines:
        text = line.get("text") or ""
        tokens = text.split()
        line_start = (line.get("startMs") or 0) / 1000
        line_end = (line.get("endMs") or 0) / 1000
        if line_end <= line_start:
            # El backend (pipelineLinesFor) emite endMs == startMs a proposito
            # para el ultimo renglon del documento; su propio docstring dice
            # que el consumidor lo acota contra la duracion real del audio.
            # Sin esto, whisperx.align recibe un tramo vacio y la linea sale
            # sin words (backtrack falla sobre 0 samples).
            line_end = audio_duration
        line_end = max(line_end, line_start)  # guarda: offset manual mas alla del audio real no debe invertir las cotas

        words: list = []
        if tokens:
            # " ".join(tokens), no `text` crudo: whisperx corta las words SOLO
            # por " " (alignment.py), pero tokens = text.split() corta por
            # CUALQUIER whitespace (tab, NBSP, letra pegada de un doc). Si los
            # criterios de corte no coinciden, el align emite una word de mas
            # o de menos y el emparejador se degrada a interpolacion para toda
            # la linea. Normalizar el separador antes de mandarlo mata la
            # discrepancia en la fuente en vez de tolerarla en el matching.
            segment = [{"text": " ".join(tokens), "start": line_start, "end": line_end}]
            aligned = align_fn(segment, align_model, meta, audio, device)
            for seg in aligned.get("segments") or []:
                words.extend(seg.get("words") or [])

        matched = _match_tokens_to_words(tokens, words)
        timings = _resolve_gaps(matched, line_start, line_end)

        current_line: list = []
        for tok, (t_start, t_end, score) in zip(tokens, timings):
            current_line.extend(_syllabize_word(tok, t_start, t_end, dic, score=score))
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
    en orden de documento, puede venir `[]`): NO transcribe. Corre forced
    align (whisperx.align) por linea sobre el texto dado, acotado a
    [startMs/1000, endMs/1000]. Cada entrada de `lines` produce exactamente
    una entrada de `lines_words`, en el mismo orden, con el texto APROBADO
    (no el que devuelve el align) -- PAUSE_THRESHOLD_S no aplica en este
    modo. `language` ("es"|"en") viene del gate, clampeado a es/en; sin dato
    o invalido, default "es".

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

            if lines is not None:
                language = _clamp_language(language)
                align_model, meta = whisperx.load_align_model(language_code=language, device=device)
                audio_duration = len(audio) / AUDIO_SAMPLE_RATE
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

        if lines is not None:
            lines_words = _lines_words_from_given_lines(
                whisperx.align, align_model, meta, audio, device, lines, audio_duration, dic
            )
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
