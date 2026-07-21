# modal/pitch/separation.py
"""Nodo GPU de hkn-pitch: separacion de voces (lead/backing).

Fase 'separation' del pipeline Partitura vocal M1. Corre BS-RoFormer ep_317
sobre el audio original para extraer SOLO el stem vocal, y luego Mel-RoFormer
Karaoke para dividir ese vocal en voz lider (lead) y coros (backing). Sube
ambos stems y postea UN webhook de fase. Devuelve los bytes de lead/backing EN
MEMORIA para la fase f0 siguiente (evita volver a descargar).

Tecnica de inferencia espejada de modal/sections/extract.py (BS-RoFormer
ep_317) y modal/sections/lead_backing.py (Mel-RoFormer Karaoke, checkpoint
elegido en Task 4, reemplaza a MedleyVox SDR ~6.9) — codigo propio, esos
modulos NO se importan (dominio distinto).
"""
from __future__ import annotations
import os

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key

# Modelo de separacion vocal (igual que sections/extract.py). Swap SOTA
# jul-2026 con rollback por env var: VOCAL_MODEL_CKPT=<filename> permite
# volver a ep_317 sin redeploy de codigo.
_BS_ROFORMER_MODEL = os.environ.get(
    "VOCAL_MODEL_CKPT",
    "melband_roformer_big_beta4.ckpt",
)

# Checkpoint karaoke (igual que sections/lead_backing.py, elegido en Task 4).
# Rollback por env var: KARAOKE_MODEL_CKPT=<filename> permite volver atras
# sin redeploy de codigo.
_KARAOKE_MODEL_CKPT = os.environ.get(
    "KARAOKE_MODEL_CKPT",
    "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt",
)
_SAMPLE_RATE = 24_000


def run_separation(job_id, webhook, sign_upload_url, inbound_secret, audio_bytes):
    """
    Nodo GPU de la fase 'separation'. Recibe los bytes del audio original,
    separa el stem vocal con BS-RoFormer ep_317 (single stem "Vocals") y lo
    divide en lead/backing con Mel-RoFormer Karaoke (checkpoint elegido en
    Task 4, SDR ~10.2; el modelo etiqueta las fuentes por nombre de archivo,
    "(Vocals)"=lead / "(Instrumental)"=backing, sin heuristica de RMS). Sube
    stems/lead.wav y stems/backing.wav, postea UN webhook 'separation' con
    ambos artefactos, y devuelve (lead_bytes, backing_bytes) para f0.py
    (evita re-descargar/re-separar).

    En fallo: post_webhook(..., {"ok": False, "error": str(exc)[:400]}) y
    re-lanza (run_pipeline decide la cascada).
    """
    # Imports pesados dentro de la funcion: solo existen en el contenedor Modal.
    import io
    import tempfile

    import librosa
    import soundfile as sf
    from audio_separator.separator import Separator

    try:
        # ── 1. Escribir audio_bytes a un archivo temporal ────────────────────
        fd, src_path = tempfile.mkstemp(suffix=".audio")
        with os.fdopen(fd, "wb") as f:
            f.write(audio_bytes)

        # ── 2. BS-RoFormer ep_317: extraer SOLO el stem vocal ────────────────
        vocals_out = tempfile.mkdtemp()
        vocals_sep = Separator(
            output_dir=vocals_out,
            output_format="wav",
            output_single_stem="Vocals",
        )
        vocals_sep.load_model(model_filename=_BS_ROFORMER_MODEL)
        vocals_files = vocals_sep.separate(src_path)
        if not vocals_files:
            raise RuntimeError("ep_317 no produjo el stem vocal")
        vocals_path = vocals_files[0]
        if not os.path.isabs(vocals_path):
            vocals_path = os.path.join(vocals_out, vocals_path)

        # ── 3. Mel-RoFormer Karaoke: dividir el vocal en lead/backing ────────
        # Igual patron que sections/lead_backing.py: el checkpoint se resuelve
        # como cualquier modelo de audio-separator (sin descarga de pesos vía
        # huggingface_hub), y clasifica las fuentes por nombre de archivo.
        karaoke_out = tempfile.mkdtemp()
        karaoke_sep = Separator(output_dir=karaoke_out, output_format="wav")
        karaoke_sep.load_model(model_filename=_KARAOKE_MODEL_CKPT)
        karaoke_files = karaoke_sep.separate(vocals_path)

        lead_path = backing_path = None
        for fname in karaoke_files:
            fpath = fname if os.path.isabs(fname) else os.path.join(karaoke_out, fname)
            low = os.path.basename(fpath).lower()
            if "(vocals)" in low:
                lead_path = fpath
            else:
                # El stem no-lead se mapea a backing sin importar como lo
                # nombre el checkpoint (p. ej. "(instrumental)" u "(other)");
                # el modelo produce exactamente 2 stems.
                backing_path = fpath
        if lead_path is None or backing_path is None:
            raise RuntimeError(
                "karaoke no produjo los stems 'lead'/'backing' esperados. "
                f"Archivos: {karaoke_files}"
            )

        # ── 4. Materializar lead/backing como WAV bytes (24kHz) ──────────────
        lead_wav, _ = librosa.load(lead_path, sr=_SAMPLE_RATE, mono=True)
        backing_wav, _ = librosa.load(backing_path, sr=_SAMPLE_RATE, mono=True)
        lead_buf = io.BytesIO()
        backing_buf = io.BytesIO()
        sf.write(lead_buf, lead_wav, _SAMPLE_RATE, format="WAV")
        sf.write(backing_buf, backing_wav, _SAMPLE_RATE, format="WAV")
        lead_bytes = lead_buf.getvalue()
        backing_bytes = backing_buf.getvalue()

        # ── 5. Subir ambos stems (key relativa; Vercel antepone el prefijo) ──
        put_lead = request_signed_put(sign_upload_url, inbound_secret, job_id, "stems/lead.wav")
        upload_put(put_lead, lead_bytes, "audio/wav")
        key_lead = extract_storage_key(put_lead)

        put_backing = request_signed_put(sign_upload_url, inbound_secret, job_id, "stems/backing.wav")
        upload_put(put_backing, backing_bytes, "audio/wav")
        key_backing = extract_storage_key(put_backing)

        # ── 6. Webhook de exito ───────────────────────────────────────────────
        post_webhook(webhook, job_id, "separation", {
            "ok": True,
            "artifacts": [
                artifact("stem_lead", key_lead, "audio/wav"),
                artifact("stem_backing", key_backing, "audio/wav"),
            ],
        })
    except Exception as exc:
        post_webhook(webhook, job_id, "separation", {"ok": False, "error": str(exc)[:400]})
        raise

    return lead_bytes, backing_bytes
