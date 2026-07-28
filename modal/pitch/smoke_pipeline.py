# modal/pitch/smoke_pipeline.py
"""Smoke manual del pipeline hkn-pitch (M1). NO se corre en CI.

Corre el DAG completo (separation -> f0 -> notes -> lyrics -> fusion -> render)
contra un audio corto real de catalogo Hakuna, para validar a mano los
SUPUESTOS que no cubre pytest (BS-RoFormer+MedleyVox, torchcrepe, WhisperX,
el reparto de silabas y el shape de analysis.json).

Requiere:
  - El secret Modal 'pitch-hmac' (PITCH_MODAL_INBOUND_SECRET + PITCH_MODAL_WEBHOOK_SECRET).
  - Un deploy Preview de Vercel VIVO para que sign-upload/webhook respondan de
    verdad: pasa --sign-upload-url y --webhook-url apuntando a ese preview, y un
    --get-url firmado (GET) del audio de entrada subido al bucket pitch-jobs.
  - Una fila en pitch_jobs con ese jobId y status compatible (el webhook aplica
    las fases sobre ese job; sin fila real, applyPhaseWebhook no encontrara el job).

Uso (ejemplo):
  modal run modal/pitch/smoke_pipeline.py \
    --job-id <uuid-real-de-pitch_jobs> \
    --get-url 'https://...signed-get...' \
    --sign-upload-url 'https://<preview>.vercel.app/api/pitch/sign-upload' \
    --webhook-url 'https://<preview>.vercel.app/api/pitch/webhook'

Corre run_pipeline SINCRONO (.remote(), bloqueante) e imprime cuando termina;
el estado real de cada fase se observa en la fila pitch_jobs (via el webhook).
"""
from __future__ import annotations

from pitch_app import app, run_pipeline


@app.local_entrypoint()
def main(job_id: str, get_url: str, sign_upload_url: str, webhook_url: str):
    payload = {
        "jobId": job_id,
        "input": {"getUrl": get_url},
        "signUploadUrl": sign_upload_url,
        # Design B: solo la url; Modal firma con PITCH_MODAL_WEBHOOK_SECRET del env.
        "webhook": {"url": webhook_url},
    }
    print(f"[smoke] lanzando run_pipeline para job {job_id} (bloqueante)...")
    run_pipeline.remote(payload)
    print("[smoke] run_pipeline termino. Revisa el estado de cada fase en la "
          "fila pitch_jobs (aplicado via webhook).")
