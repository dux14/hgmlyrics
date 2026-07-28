# modal/pitch/notes.py
"""Nodo CPU-only de hkn-pitch: segmenta eventos de nota por voz."""
from __future__ import annotations
import json

from core import note_events_from_f0
from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key


def run_notes(job_id, webhook, sign_upload_url, inbound_secret, f0_lead, f0_backing):
    """
    Nodo CPU de la fase 'notes'. f0_lead/f0_backing son dicts {times, f0, conf}
    (arrays numpy) que produce f0.py. Segmenta cada voz con
    core.note_events_from_f0, sube notes/lead.json y notes/backing.json, y
    postea UN webhook 'notes' con ambos artefactos. Devuelve (notes_lead,
    notes_backing) para fusion.py.

    En fallo: post_webhook(..., {"ok": False, "error": str(exc)[:400]}) y
    re-lanza (run_pipeline decide la cascada).
    """
    try:
        notes_lead = note_events_from_f0(**f0_lead)
        notes_backing = note_events_from_f0(**f0_backing)

        keys = {}
        for voz, events in (("lead", notes_lead), ("backing", notes_backing)):
            data = json.dumps(events).encode("utf-8")
            put_url = request_signed_put(sign_upload_url, inbound_secret, job_id, f"notes/{voz}.json")
            upload_put(put_url, data, content_type="application/json")
            keys[voz] = extract_storage_key(put_url)

        post_webhook(webhook, job_id, "notes", {
            "ok": True,
            "artifacts": [
                artifact("notes_lead", keys["lead"], "application/json"),
                artifact("notes_backing", keys["backing"], "application/json"),
            ],
        })
    except Exception as exc:
        post_webhook(webhook, job_id, "notes", {"ok": False, "error": str(exc)[:400]})
        raise

    return notes_lead, notes_backing
