# modal/transcribe_diff.py
"""Funciones puras del gate de letra: normalizacion + score por linea (CER
via jiwer). La ortografia final NUNCA sale de aqui (solo se usa para comparar)."""
from __future__ import annotations
import re
import unicodedata

import jiwer


def normalize_for_compare(text: str) -> str:
    """Minusculas, sin tildes/diacriticos ni puntuacion, espacios colapsados.
    NFD descompone tambien la enie (n + combining tilde U+0303, categoria Mn),
    asi que tras quitar los Mn la enie queda como 'n' -- comportamiento
    esperado por el contrato (comparacion tolerante, no ortografia final)."""
    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = t.lower()
    t = re.sub(r"[^a-z0-9ñ\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def line_scores(trans_lines: list[str], db_lines: list[str]) -> list[dict]:
    """Para cada linea transcrita, el mejor match en db_lines y su score
    (1 - CER normalizado, acotado a [0,1])."""
    out = []
    norm_db = [normalize_for_compare(l) for l in db_lines]
    for i, raw in enumerate(trans_lines):
        a = normalize_for_compare(raw)
        best_j, best = None, 0.0
        for j, b in enumerate(norm_db):
            if not a or not b:
                continue
            # `a` (linea transcrita) como referencia: normaliza el CER por su
            # longitud, no la del candidato db, asi una linea db mucho mas
            # larga/corta no distorsiona el score (ver test de alineacion).
            score = max(0.0, 1.0 - jiwer.cer(a, b))
            if score > best:
                best_j, best = j, score
        out.append({"transIndex": i, "dbIndex": best_j, "score": round(best, 4)})
    return out
