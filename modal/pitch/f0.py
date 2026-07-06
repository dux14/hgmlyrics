# modal/pitch/f0.py
"""Nodo GPU de hkn-pitch: extrae el contorno F0 (torchcrepe/CREPE) por voz."""
from __future__ import annotations
import io

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key


def _f0_contour(wav_bytes: bytes) -> dict:
    """Corre torchcrepe sobre `wav_bytes` (WAV de una voz) y devuelve
    {"times", "f0", "conf"} (arrays numpy 1-D float32). Sin filtros/thresholds
    extra: note_events_from_f0 ya filtra por confianza."""
    import numpy as np
    import torch
    import torchcrepe
    import librosa

    audio, _ = librosa.load(io.BytesIO(wav_bytes), sr=16000, mono=True, dtype=np.float32)
    audio_t = torch.tensor(audio)[None]  # (1, samples)
    hop = 160  # 10 ms a 16 kHz
    device = "cuda" if torch.cuda.is_available() else "cpu"
    pitch, periodicity = torchcrepe.predict(
        audio_t, 16000, hop_length=hop, model="full",
        return_periodicity=True, device=device, batch_size=512, fmin=50, fmax=1100,
    )
    f0 = pitch.squeeze(0).cpu().numpy().astype(np.float32)
    conf = periodicity.squeeze(0).cpu().numpy().astype(np.float32)
    times = (np.arange(f0.shape[0]) * hop / 16000).astype(np.float32)
    return {"times": times, "f0": f0, "conf": conf}


def run_f0(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes, backing_bytes):
    """
    Nodo GPU de la fase 'f0'. Corre torchcrepe sobre lead_bytes/backing_bytes
    (WAV de la fase separation), sube cada contorno a Storage como .npz, postea
    UN webhook 'f0' con ambos artefactos, y devuelve (f0_lead, f0_backing) EN
    MEMORIA para la fase 'notes'.

    En fallo: post_webhook(..., {"ok": False, "error": str(exc)[:400]}) y
    re-lanza (run_pipeline decide la cascada).
    """
    import numpy as np

    try:
        f0_lead = _f0_contour(lead_bytes)
        f0_backing = _f0_contour(backing_bytes)

        keys = {}
        for voz, contour in (("lead", f0_lead), ("backing", f0_backing)):
            buf = io.BytesIO()
            np.savez(buf, times=contour["times"], f0=contour["f0"], conf=contour["conf"])
            put_url = request_signed_put(sign_upload_url, inbound_secret, job_id, f"f0/{voz}.npz")
            upload_put(put_url, buf.getvalue(), content_type="application/octet-stream")
            keys[voz] = extract_storage_key(put_url)

        post_webhook(webhook, job_id, "f0", {
            "ok": True,
            "artifacts": [
                artifact("f0_lead", keys["lead"], "application/octet-stream"),
                artifact("f0_backing", keys["backing"], "application/octet-stream"),
            ],
        })
    except Exception as exc:
        post_webhook(webhook, job_id, "f0", {"ok": False, "error": str(exc)[:400]})
        raise

    return f0_lead, f0_backing
