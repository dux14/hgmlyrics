# modal/align_mapping.py
"""
Mapeo puro palabras (WhisperX) -> lineas (letra canonica de la cancion).

Sin dependencias de modal/whisperx: solo stdlib. Se puede correr con pytest
en Python 3.9 local, sin GPU (ver test_align_mapping.py).

`from __future__ import annotations` porque el entorno local que evalua este
modulo (pytest, y `modal deploy` al importar align_app.py) es Python 3.9, que
no soporta `list[dict]` como anotacion en runtime sin diferir su evaluacion.
"""

from __future__ import annotations

import re
import unicodedata

# Tamano maximo de ventana de tokens silabicos que se intenta concatenar para
# matchear una sola palabra de WhisperX. La notacion silabica del wiki rara
# vez fragmenta una palabra en mas de 6-7 silabas/alargamientos.
_MAX_WINDOW = 8

_VOWELS = "aeiou"
_ELONGATION_RE = re.compile(f"([{_VOWELS}])\\1+")
_NON_LETTER_RE = re.compile(r"[^a-zñ0-9]")


def _strip_accents(text: str) -> str:
    """Quita tildes/diacriticos preservando la letra base ('á' -> 'a'), pero
    preserva 'ñ'/'Ñ' como letra propia (NO es un caso de tilde: en espanol
    'ano'/'año' y 'senor'/'señor' son palabras distintas). NFKD descompone
    'ñ' en 'n' + tilde combinante (U+0303), así que si se filtrara igual que
    el resto de combinantes se perderia la eñe. Por eso se protege con un
    placeholder antes de NFKD y se restaura despues."""
    protected = text.replace("ñ", "\x00").replace("Ñ", "\x01")
    decomposed = unicodedata.normalize("NFKD", protected)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.replace("\x00", "ñ").replace("\x01", "Ñ")


def _collapse_elongation(token: str) -> str:
    """Colapsa una secuencia de la MISMA vocal repetida (>=2) a una sola:
    'cieee' -> 'cie', 'sooo' -> 'so', 'dioos' -> 'dios'."""
    return _ELONGATION_RE.sub(r"\1", token)


def _clean_token(raw: str) -> str:
    """minusculas, sin tildes, sin puntuacion. No colapsa alargamientos (eso
    lo hace el llamador, una vez por token individual y de nuevo sobre
    concatenaciones de varios tokens al matchear)."""
    lowered = _strip_accents(raw.lower())
    return _NON_LETTER_RE.sub("", lowered)


def normalize(text: str) -> list[str]:
    """
    minusculas, sin tildes/puntuacion; colapsa alargamientos ('cieee'->'cie',
    'ñooor'->'ñor') y separa en tokens por espacios y guiones de la notacion
    silabica del wiki ('Sa - a - an - to' -> tokens ['sa','a','an','to']).

    Cada token se colapsa individualmente. La union de tokens consecutivos
    para formar una palabra completa (p.ej. 'sa'+'a'+'an'+'to' ~ 'santo') es
    responsabilidad de `map_words_to_lines`, que vuelve a colapsar la
    concatenacion (el alargamiento silabico cruza limites de token: "Sa-a-a-
    an-to" son 4 "a" consecutivas repartidas en tokens separados).
    """
    raw_tokens = re.split(r"[\s\-]+", text)
    tokens: list[str] = []
    for raw in raw_tokens:
        cleaned = _clean_token(raw)
        if not cleaned:
            continue
        tokens.append(_collapse_elongation(cleaned))
    return tokens


def _normalize_word(word: str) -> str | None:
    """Normaliza una palabra suelta de WhisperX a un solo token comparable.
    Devuelve None si la palabra no aporta ningun caracter valido (p.ej. solo
    puntuacion)."""
    tokens = normalize(word)
    if not tokens:
        return None
    return "".join(tokens)


def map_words_to_lines(lines: list[dict], words: list[dict]) -> list[dict]:
    """
    lines: [{'i':0,'text':'...'}], words: [{'word':'...','start':1.2}] (WhisperX,
    en orden cronologico; palabras sin 'start' se ignoran).

    Matching greedy secuencial: se recorren las lineas en el orden recibido,
    tokenizando cada una (`normalize`); se recorren las palabras de WhisperX en
    orden, intentando anclar cada una contra una ventana de 1.._MAX_WINDOW
    tokens consecutivos a partir del cursor actual (nunca retrocede). Una
    ventana matchea si su concatenacion, tras volver a colapsar alargamientos
    en el limite entre tokens, es igual a la palabra normalizada.

    startMs de una linea = start (ms) de la primera palabra que ancla alguno
    de sus tokens. Lineas sin ninguna ancla interpolan linealmente entre sus
    vecinas ancladas; la primera/ultima linea sin ancla extrapolan usando la
    pendiente del primer/ultimo tramo. Una ancla que llegue fuera de orden
    (startMs <= la ancla aceptada anterior) se descarta (la linea queda como
    no anclada e interpola igual que cualquier otra).

    Devuelve [{'i':0,'startMs':1200}, ...] SIEMPRE con startMs entero,
    monotono ESTRICTAMENTE creciente (colisiones de redondeo se resuelven
    empujando +1ms).
    """
    ordered_lines = list(lines)
    n_lines = len(ordered_lines)

    # Tokenizar cada linea y recordar a que linea (indice en ordered_lines)
    # pertenece cada token de la secuencia aplanada.
    flat_tokens: list[str] = []
    token_line_idx: list[int] = []
    for idx, line in enumerate(ordered_lines):
        for tok in normalize(line.get("text", "")):
            flat_tokens.append(tok)
            token_line_idx.append(idx)

    n_tokens = len(flat_tokens)

    # Palabras de WhisperX validas (con 'start'), normalizadas.
    norm_words: list[tuple[str, float]] = []
    for w in words:
        start = w.get("start")
        if start is None:
            continue
        norm = _normalize_word(w.get("word", ""))
        if norm is None:
            continue
        norm_words.append((norm, float(start)))

    # Matching greedy secuencial: cursor sobre flat_tokens, nunca retrocede.
    raw_anchor_ms: dict[int, float] = {}
    tok_ptr = 0
    for norm_word, start_sec in norm_words:
        matched_end = None
        matched_line_idx = None
        for pos in range(tok_ptr, n_tokens):
            for window in range(1, _MAX_WINDOW + 1):
                end = pos + window
                if end > n_tokens:
                    break
                concat = _collapse_elongation("".join(flat_tokens[pos:end]))
                if concat == norm_word:
                    matched_end = end
                    matched_line_idx = token_line_idx[pos]
                    break
            if matched_end is not None:
                break
        if matched_end is not None:
            tok_ptr = matched_end
            # Solo la PRIMERA ancla de cada linea cuenta (regla del docstring).
            if matched_line_idx not in raw_anchor_ms:
                raw_anchor_ms[matched_line_idx] = start_sec * 1000.0

    # Forzar monotonicidad: recorrer lineas en orden, descartando anclas que
    # no superen estrictamente la ultima ancla aceptada.
    accepted_ms: dict[int, float] = {}
    last_ms = -1.0
    for idx in range(n_lines):
        if idx in raw_anchor_ms:
            ms = raw_anchor_ms[idx]
            if ms > last_ms:
                accepted_ms[idx] = ms
                last_ms = ms
            # si no: se descarta, la linea queda sin ancla (interpola).

    # Interpolar/extrapolar startMs (float) para TODAS las lineas.
    result_ms: list[float] = [0.0] * n_lines
    anchored_idxs = sorted(accepted_ms.keys())

    if not anchored_idxs:
        # Ninguna linea anclo ninguna palabra: no hay referencia temporal.
        # Se emite una rampa minima (0,1,2,...ms) solo para mantener el
        # contrato de salida (monotono creciente); no deberia ocurrir en uso
        # real (implica que WhisperX no reconocio nada del audio).
        result_ms = [float(i) for i in range(n_lines)]
    else:
        for idx, ms in accepted_ms.items():
            result_ms[idx] = ms

        first = anchored_idxs[0]
        if first > 0:
            if len(anchored_idxs) >= 2:
                second = anchored_idxs[1]
                slope = (accepted_ms[second] - accepted_ms[first]) / (second - first)
            else:
                slope = 0.0
            for idx in range(first - 1, -1, -1):
                result_ms[idx] = accepted_ms[first] - slope * (first - idx)

        for k in range(len(anchored_idxs) - 1):
            a, b = anchored_idxs[k], anchored_idxs[k + 1]
            if b - a > 1:
                span_ms = accepted_ms[b] - accepted_ms[a]
                for idx in range(a + 1, b):
                    frac = (idx - a) / (b - a)
                    result_ms[idx] = accepted_ms[a] + span_ms * frac

        last = anchored_idxs[-1]
        if last < n_lines - 1:
            if len(anchored_idxs) >= 2:
                prev = anchored_idxs[-2]
                slope = (accepted_ms[last] - accepted_ms[prev]) / (last - prev)
            else:
                slope = 0.0
            for idx in range(last + 1, n_lines):
                result_ms[idx] = accepted_ms[last] + slope * (idx - last)

    # Redondear a enteros forzando monotonicidad estricta (colisiones de
    # redondeo se empujan +1ms; nunca negativo).
    out: list[dict] = []
    prev_int = -1
    for idx in range(n_lines):
        ms_int = max(0, round(result_ms[idx]))
        if ms_int <= prev_int:
            ms_int = prev_int + 1
        prev_int = ms_int
        out.append({"i": ordered_lines[idx]["i"], "startMs": ms_int})
    return out
