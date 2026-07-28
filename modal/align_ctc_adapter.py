# modal/align_ctc_adapter.py
"""Adaptador: salida de ctc-forced-aligner -> formato de segments/words que
consume align_mapping (identico al de whisperx.align). CPU-only, testeable."""
from __future__ import annotations


def ctc_words_to_whisperx_segments(ctc_words: list[dict]) -> list[dict]:
    words = [
        {
            "word": w["text"],
            "start": float(w["start"]),
            "end": float(w["end"]),
            "score": float(w.get("score", 0.0)),
        }
        for w in ctc_words
        if (w.get("text") or "").strip()
    ]
    return [{"words": words}]
