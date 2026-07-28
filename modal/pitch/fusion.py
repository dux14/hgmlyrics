# modal/pitch/fusion.py
"""Nodo CPU de la fase 'fusion'. Ensambla analysis.json multi-voz a partir de
las lineas/silabas transcritas (lyrics) y los eventos de nota por voz (notes).
Solo ensamblado + I/O (upload + webhook): la logica pura vive en core.py."""
from __future__ import annotations

import json

from core import (
    fuse_syllables_notes, detect_modulations, merge_voices_present,
    detect_key, key_uses_flats, midi_to_name, NOTE_NAMES_FLAT, NOTE_NAMES_SHARP,
    orphan_note_spans,
)
from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key


def assemble_analysis(base_voices: dict, modulations: list, voices_present_base: list,
                      extra_voices: dict | None = None) -> dict:
    """Ensambla analysis.json admitiendo voces extra (genero/coro) sin romper
    lead/backing. Puro, sin I/O."""
    voices = {**base_voices, **(extra_voices or {})}
    voices_present = merge_voices_present(voices_present_base, list((extra_voices or {}).keys()))
    return {"voices_present": voices_present, "voices": voices, "modulations": modulations}


def run_fusion(job_id, webhook, sign_upload_url, inbound_secret, notes_lead, notes_backing, lines_words,
               extra_voices=None):
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
        # Detecta la tonalidad (histograma de pitch-classes ponderado por duracion,
        # sumando todas las voces) para elegir bemoles o sostenidos en la armadura.
        def _accumulate(hist, events):
            for ev in events or []:
                midi = ev.get("midi")
                if midi is None:
                    continue
                dur = ev.get("end", 0.0) - ev.get("start", 0.0)
                hist[int(round(midi)) % 12] += dur if dur and dur > 0 else 1.0

        hist = [0.0] * 12
        _accumulate(hist, notes_lead)
        _accumulate(hist, notes_backing)
        for v in (extra_voices or {}).values():
            _accumulate(hist, v.get("notes", []))

        tonic_pc, mode = detect_key(hist)
        use_flats = key_uses_flats(tonic_pc, mode)

        for v in (extra_voices or {}).values():
            for n in v.get("notes", []):
                if n.get("midi") is not None:
                    n["note"] = midi_to_name(n["midi"], use_flats)

        def voice_lines(note_events):
            lines = []
            for words in lines_words:
                syls = [dict(w) for w in words]
                fuse_syllables_notes(syls, note_events, use_flats)
                lines.append({"syllables": syls})
            return lines

        base_voices = {
            "lead": {"lines": voice_lines(notes_lead)},
            "backing": {"lines": voice_lines(notes_backing)},
        }
        analysis = assemble_analysis(
            base_voices, detect_modulations(notes_lead, use_flats=use_flats), ["lead", "backing"], extra_voices
        )
        analysis["key"] = {
            "tonic": (NOTE_NAMES_FLAT if use_flats else NOTE_NAMES_SHARP)[tonic_pc],
            "mode": mode,
            "use_flats": use_flats,
        }

        # Aviso best-effort de tramos de canto sin cobertura en la letra
        # aprobada (Tarea 3.3): una excepcion aqui no puede tumbar la fusion.
        try:
            lead_syllables = [syl for line in base_voices["lead"]["lines"] for syl in line["syllables"]]
            analysis["warnings"] = {"orphanSpans": orphan_note_spans(notes_lead, lead_syllables)}
        except Exception:
            pass

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
