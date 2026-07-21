# modal/pitch/gender.py — nodo opcional (M5): separacion lead por genero (male/female).
"""Fase opcional 'gender' (flag PITCH_CHOIR — comparte flag con choir_basicpitch.py,
ambos son voces "sin letra" del mismo experimento M5): separa el stem lead en
male/female con chorus_bs_roformer (ep_267, overlap 16) y calcula f0/notas por
cada uno con el mismo pipeline que f0.py/core.py (torchcrepe + note_events_from_f0).

Tecnica de separacion espejada de modal/sections/gender.py (Estudio), con un
diff deliberado:
  1. Imports de _common/core/f0 de PITCH (no de sections): dominio propio, no
     se importa modal/sections/ (mismo criterio que separation.py).

(Nota historica: sections/gender.py llego a correr TAMBIEN aufr33 en un A/B;
se elimino esa rama en Task 7 al no encontrarse checkpoint aufr33 valido en
audio-separator 0.28.5, asi que ambos modulos usan hoy UN SOLO modelo.)

Igual que choir_basicpitch.py: opcional, NUNCA re-lanza (un fallo no debe
tumbar el pipeline REQUIRED de pitch_app.py)."""
from __future__ import annotations
import os

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key
from core import note_events_from_f0, build_voice_entry
from f0 import _f0_contour

# Checkpoint chorus_bs_roformer (igual que sections/gender.py; SDR 24.13).
_GENDER_MODEL_CKPT = "model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt"

# Overlap subido a 16 (vs default 8): split de genero mas limpio a costa de
# ~2x tiempo (igual que sections/gender.py, validado en su PoC v2).
_GENDER_OVERLAP = 16


def _classify_stem(filename: str) -> "str | None":
    """Mapea el nombre de archivo de un stem a 'male' o 'female'. audio-separator
    produce nombres del tipo 'vocals_(Female)_model_chorus_...wav'. IMPORTANTE:
    'female' contiene 'male' como substring, por eso SIEMPRE se chequea 'female'
    primero (mismo orden que sections/gender.py). None si no se reconoce."""
    low = filename.lower()
    if "female" in low:
        return "female"
    if "male" in low:
        return "male"
    return None


def separate_by_gender(vocals_bytes: bytes) -> dict:
    """Corre chorus_bs_roformer (overlap 16) sobre `vocals_bytes` (WAV del
    stem lead) y devuelve {"male": wav_bytes, "female": wav_bytes}. Pura en el
    sentido de que no sube nada ni postea webhook; SI toca disco (audio-separator
    exige paths de archivo), vía temporales."""
    import tempfile
    from audio_separator.separator import Separator  # solo en el contenedor

    fd, vocals_path = tempfile.mkstemp(suffix=".wav")
    with os.fdopen(fd, "wb") as f:
        f.write(vocals_bytes)

    out_dir = tempfile.mkdtemp()
    sep = Separator(
        output_dir=out_dir,
        output_format="wav",
        mdxc_params={
            "segment_size": 256,
            "override_model_segment_size": False,
            "batch_size": 1,
            "overlap": _GENDER_OVERLAP,
            "pitch_shift": 0,
        },
    )
    sep.load_model(model_filename=_GENDER_MODEL_CKPT)
    out_files = sep.separate(vocals_path)

    stems: dict[str, bytes] = {}
    for fname in out_files:
        fpath = fname if os.path.isabs(fname) else os.path.join(out_dir, fname)
        label = _classify_stem(os.path.basename(fpath))
        if label is None:
            raise RuntimeError(
                "chorus_bs_roformer produjo un stem inesperado "
                f"(no contiene 'male' ni 'female'): {os.path.basename(fpath)}"
            )
        with open(fpath, "rb") as fh:
            stems[label] = fh.read()

    for required in ("male", "female"):
        if required not in stems:
            raise RuntimeError(
                f"chorus_bs_roformer no produjo el stem requerido '{required}'. "
                f"Stems presentes: {list(stems.keys())}"
            )
    return stems


def run_gender(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes):
    """Nodo opcional GPU: separa lead_bytes en male/female, calcula f0+notas de
    cada uno (_f0_contour + note_events_from_f0, igual que f0.py/notes.py),
    sube 4 artefactos (stem_male, stem_female, notes_male, notes_female) y
    postea UN webhook phase='gender'. Devuelve {"male": entry, "female": entry}.
    NUNCA re-lanza (fase opcional)."""
    import json

    try:
        stems = separate_by_gender(lead_bytes)

        artifacts = []
        entries = {}
        for voice in ("male", "female"):
            stem_bytes = stems[voice]

            put_stem = request_signed_put(sign_upload_url, inbound_secret, job_id, f"stems/{voice}.wav")
            upload_put(put_stem, stem_bytes, content_type="audio/wav")
            artifacts.append(artifact(f"stem_{voice}", extract_storage_key(put_stem), "audio/wav"))

            contour = _f0_contour(stem_bytes)
            notes = note_events_from_f0(contour["times"], contour["f0"], contour["conf"])
            entry = build_voice_entry(notes)
            entries[voice] = entry

            put_notes = request_signed_put(sign_upload_url, inbound_secret, job_id, f"notes/{voice}.json")
            upload_put(put_notes, json.dumps(entry).encode(), content_type="application/json")
            artifacts.append(artifact(f"notes_{voice}", extract_storage_key(put_notes), "application/json"))

        post_webhook(webhook, job_id, "gender", {"ok": True, "artifacts": artifacts})
        return entries
    except Exception as exc:
        post_webhook(webhook, job_id, "gender", {"ok": False, "error": str(exc)[:400]})
        return {}  # opcional: no re-lanza
