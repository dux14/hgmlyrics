# modal/pitch/f0.py
"""Nodo GPU de hkn-pitch: extrae el contorno F0 por voz.

Motor por env var F0_ENGINE: 'fcpe' (default, torchfcpe, arXiv 2509.15140) o
'crepe' (torchcrepe full, rollback). Ambos devuelven el mismo contrato
{"times","f0","conf"} float32 con hop de 10 ms, que consume notes.py.
"""
from __future__ import annotations
import io
import os

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key

_SR = 16_000
_HOP = 160  # 10 ms a 16 kHz


def _as_f0_contract(times, f0, conf):
    """Normaliza los arrays de cualquier motor al contrato float32 1-D."""
    import numpy as np

    times = np.asarray(times, dtype=np.float32).reshape(-1)
    f0 = np.asarray(f0, dtype=np.float32).reshape(-1)
    conf = np.asarray(conf, dtype=np.float32).reshape(-1)
    if not (times.shape == f0.shape == conf.shape):
        raise ValueError(
            f"F0 contract mismatch: times={times.shape} f0={f0.shape} conf={conf.shape}"
        )
    return {"times": times, "f0": f0, "conf": conf}


def _f0_crepe(audio):
    """torchcrepe CREPE full (motor original, rollback)."""
    import numpy as np
    import torch
    import torchcrepe

    audio_t = torch.tensor(audio)[None]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    pitch, periodicity = torchcrepe.predict(
        audio_t, _SR, hop_length=_HOP, model="full",
        return_periodicity=True, device=device, batch_size=512, fmin=50, fmax=1100,
    )
    f0 = pitch.squeeze(0).cpu().numpy()
    conf = periodicity.squeeze(0).cpu().numpy()
    times = np.arange(f0.shape[0]) * _HOP / _SR
    return _as_f0_contract(times, f0, conf)


def _f0_fcpe(audio):
    """torchfcpe (FCPE): mismo hop de 10 ms, decoder local con confianza."""
    import numpy as np
    import torch
    from torchfcpe import spawn_bundled_infer_model

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = spawn_bundled_infer_model(device=device)
    audio_t = torch.tensor(audio, dtype=torch.float32)[None, :, None].to(device)
    f0_t = model.infer(
        audio_t,
        sr=_SR,
        decoder_mode="local_argmax",
        threshold=0.006,
        f0_min=50,
        f0_max=1100,
        output_interp_target_length=None,
    )
    f0 = f0_t.squeeze().cpu().numpy()
    # torchfcpe devuelve 0.0 en frames no vocales con este threshold; la
    # confianza binaria (vocal/no-vocal) es suficiente para
    # note_events_from_f0, que filtra por conf.
    conf = (f0 > 0).astype(np.float32)
    times = np.arange(f0.shape[0]) * _HOP / _SR
    return _as_f0_contract(times, f0, conf)


def _f0_contour(wav_bytes: bytes) -> dict:
    """Carga el WAV y corre el motor elegido por F0_ENGINE (default fcpe)."""
    import numpy as np
    import librosa

    audio, _ = librosa.load(io.BytesIO(wav_bytes), sr=_SR, mono=True, dtype=np.float32)
    engine = os.environ.get("F0_ENGINE", "fcpe")
    if engine == "crepe":
        return _f0_crepe(audio)
    return _f0_fcpe(audio)


def run_f0(job_id, webhook, sign_upload_url, inbound_secret, lead_bytes, backing_bytes):
    """
    Nodo GPU de la fase 'f0'. Corre el motor F0 sobre lead_bytes/backing_bytes
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
            "engine": os.environ.get("F0_ENGINE", "fcpe"),
            "artifacts": [
                artifact("f0_lead", keys["lead"], "application/octet-stream"),
                artifact("f0_backing", keys["backing"], "application/octet-stream"),
            ],
        })
    except Exception as exc:
        post_webhook(webhook, job_id, "f0", {"ok": False, "error": str(exc)[:400]})
        raise

    return f0_lead, f0_backing
