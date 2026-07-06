# modal/pitch/fusion.py
"""Nodo CPU de la fase 'fusion'. Ensambla analysis.json multi-voz a partir de
las lineas/silabas transcritas (lyrics) y los eventos de nota por voz (notes).
Solo ensamblado + I/O (upload + webhook): la logica pura vive en core.py."""
import json

from core import fuse_syllables_notes, detect_modulations
from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key


def run_fusion(job_id, webhook, sign_upload_url, inbound_secret, notes_lead, notes_backing, lines_words):
    """
    Nodo CPU de la fase 'fusion'. Por cada voz (lead, backing) copia las MISMAS
    lineas/silabas transcritas (lines_words) y corre fuse_syllables_notes contra
    los eventos de nota de esa voz (misma letra, notas propias por voz). Arma el
    analysis.json multi-voz del brief, lo sube a export/analysis.json y postea el
    webhook 'fusion'. Devuelve el dict analysis (para render, Task 10).

    lines_words: [ [ {"text","start","end"}, ... ]  (una linea) , ... ]
    En fallo: post_webhook(..., {"ok": False, "error": str(exc)[:400]}) y re-lanza.
    """
    try:
        def voice_lines(note_events):
            lines = []
            for words in lines_words:
                syls = [dict(w) for w in words]
                fuse_syllables_notes(syls, note_events)
                lines.append({"syllables": syls})
            return lines

        analysis = {
            "voices_present": ["lead", "backing"],
            "voices": {
                "lead": {"lines": voice_lines(notes_lead)},
                "backing": {"lines": voice_lines(notes_backing)},
            },
            "modulations": detect_modulations(notes_lead),
        }

        put_url = request_signed_put(sign_upload_url, inbound_secret, job_id, "export/analysis.json")
        upload_put(put_url, json.dumps(analysis, ensure_ascii=False).encode("utf-8"), content_type="application/json")
        storage_key = extract_storage_key(put_url)

        post_webhook(webhook, job_id, "fusion", {
            "ok": True,
            "artifacts": [artifact("analysis", storage_key, "application/json")],
        })

        return analysis
    except Exception as exc:
        post_webhook(webhook, job_id, "fusion", {"ok": False, "error": str(exc)[:400]})
        raise
