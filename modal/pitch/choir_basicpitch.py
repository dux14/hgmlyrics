# modal/pitch/choir_basicpitch.py — nodo opcional (M5): notas polifonicas de coro (Basic Pitch).
"""Fase opcional 'choir' (flag PITCH_CHOIR): corre Basic Pitch (ICASSP 2022,
backend ONNX) sobre el stem lead para extraer notas POLIFONICAS (varias voces
de coro solapadas en el tiempo — a diferencia de f0.py/torchcrepe, que asume
una sola voz monofonica por stem). Igual que gender.py, es opcional: si falla
no debe tumbar el pipeline (los nodos REQUIRED de pitch_app.py son separation/
f0/notes/lyrics/fusion/render)."""
from __future__ import annotations
from core import midi_to_name, build_voice_entry
from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key


def basic_pitch_events_to_notes(events: list, min_amplitude: float = 0.3) -> list:
    """Eventos de Basic Pitch (posiblemente solapados = polifonia) -> lista de
    eventos de nota (dicts {start,end,midi,note,cents}). Filtra amplitud minima
    (ruido). Pura, sin I/O. `events` = dicts {start_time_s,end_time_s,pitch_midi,amplitude}."""
    out = []
    for ev in events:
        if ev.get("amplitude", 0) < min_amplitude:
            continue
        midi = int(round(ev["pitch_midi"]))
        out.append({"start": ev["start_time_s"], "end": ev["end_time_s"],
                    "midi": midi, "note": midi_to_name(midi), "cents": 0})
    return out


def run_choir(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes):
    """Nodo opcional GPU: corre basic_pitch.inference.predict sobre el stem lead,
    convierte los note_events a eventos de nota, sube notes/choir.json y postea
    phase='choir' con artifacts=[notes_choir]. Devuelve {"choir": voice_entry}.
    NUNCA re-lanza (fase opcional)."""
    import json, os, tempfile
    try:
        from basic_pitch.inference import predict
        from basic_pitch import build_icassp_2022_model_path, FilenameSuffix

        # Modelo explicito ONNX (ver requirements.txt): basic_pitch elige el
        # backend por orden de disponibilidad (TF > CoreML > TFLite > ONNX) y
        # tensorflow queda instalado igual en Linux+py3.11 (dependencia no
        # condicionada a un extra), asi que NO alcanza con instalar solo
        # basic-pitch[onnx] — hay que pedir el .onnx explicitamente para evitar
        # que se cargue el SavedModel de TF.
        model_path = build_icassp_2022_model_path(FilenameSuffix.onnx)

        # basic_pitch.inference.predict necesita un path de archivo: escribe
        # lead_bytes a un tmp WAV.
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            tf.write(lead_bytes); tmp_path = tf.name
        try:
            _model_out, _midi, note_events = predict(tmp_path, model_path)
        finally:
            os.unlink(tmp_path)

        # basic-pitch==0.4.0 (basic_pitch/inference.py, firma de predict()):
        # note_events = List[Tuple[start_time_s: float, end_time_s: float,
        # pitch_midi: int, amplitude: float, pitch_bend: Optional[List[int]]]].
        # Verificado contra el codigo fuente publicado en PyPI (no documentacion).
        norm = [{"start_time_s": e[0], "end_time_s": e[1], "pitch_midi": e[2], "amplitude": e[3]} for e in note_events]
        notes = basic_pitch_events_to_notes(norm)
        entry = build_voice_entry(notes)
        put = request_signed_put(sign_upload_url, inbound_secret, job_id, "notes/choir.json")
        upload_put(put, json.dumps(entry).encode(), content_type="application/json")
        post_webhook(webhook, job_id, "choir", {"ok": True, "artifacts": [artifact("notes_choir", extract_storage_key(put), "application/json")]})
        return {"choir": entry}
    except Exception as exc:
        post_webhook(webhook, job_id, "choir", {"ok": False, "error": str(exc)[:400]})
        return {}  # opcional: no re-lanza
