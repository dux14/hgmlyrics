# modal/pitch/_common.py
"""Utilidades de hkn-pitch. NO importa modal/sections/ (dominio propio)."""
from __future__ import annotations
import hashlib, hmac, json, os, time
from urllib.parse import urlparse

PITCH_BUCKET = "pitch-jobs"


def extract_storage_key(signed_put_url: str) -> str:
    """Espeja sections._common.extract_storage_key, bucket pitch-jobs."""
    path = urlparse(signed_put_url).path
    marker = f"/object/upload/sign/{PITCH_BUCKET}/"
    idx = path.find(marker)
    if idx == -1:
        raise ValueError(f"No se pudo extraer la key: {signed_put_url[:120]}")
    return path[idx + len(marker):]


def download_bytes(get_url: str, timeout: int = 120) -> bytes:
    import httpx
    with httpx.stream("GET", get_url, timeout=timeout, follow_redirects=True) as r:
        r.raise_for_status()
        return b"".join(r.iter_bytes())


def upload_put(put_url: str, data: bytes, content_type: str = "audio/wav") -> None:
    import httpx
    r = httpx.put(put_url, content=data, headers={"Content-Type": content_type}, timeout=180)
    r.raise_for_status()


def request_signed_put(sign_upload_url: str, inbound_secret: str, job_id: str, key: str) -> str:
    """Pide a Vercel (api/pitch/sign-upload) un signed PUT para `key` (debe
    empezar por `${user_id}/${job_id}/`, Vercel lo valida). Mismo
    PITCH_MODAL_INBOUND_SECRET que valida la llamada Vercel->Modal."""
    import httpx
    r = httpx.post(sign_upload_url, json={"jobId": job_id, "key": key},
                   headers={"x-inbound-secret": inbound_secret}, timeout=15)
    r.raise_for_status()
    return r.json()["url"]


def _sign_and_post(url: str, secret: str, body: dict) -> None:
    """Firma el body con HMAC-SHA256 sobre f"{ts}.{body_str}" y lo postea.
    Esquema unico compartido por post_webhook y post_pipeline_event; el
    backend lo verifica en api/_lib/modal.js::verifyModalSignature."""
    import httpx
    body_str = json.dumps(body)
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), f"{ts}.{body_str}".encode(), hashlib.sha256).hexdigest()
    r = httpx.post(url, content=body_str,
                   headers={"Content-Type": "application/json", "X-Modal-Timestamp": ts,
                            "X-Modal-Signature": sig}, timeout=30)
    r.raise_for_status()


def post_webhook(webhook: dict | None, job_id: str, phase: str, result: dict) -> None:
    """Contrato M1 (INMUTABLE): body={"jobId","phase","result"}.
    result={"ok":bool,"error"?:str,"artifacts"?:[{kind,storage_uri,mime,meta?}],"cost"?:float}.
    Design B: firma con PITCH_MODAL_WEBHOOK_SECRET del entorno (NO del payload).
    Firma: hex(hmac_sha256(secret, f"{ts}.{body_str}")), headers
    X-Modal-Timestamp/X-Modal-Signature (ver _sign_and_post). Lanza en non-2xx.
    Si `webhook` es None o no trae "url" (modo pipeline: run_pipeline le pasa un
    webhook silenciado a los nodos intermedios), no hace nada — el contrato
    {jobId,phase,result} de este helper NO es el que espera el webhook
    unificado (api/pipeline/webhook.js exige {runId,phase}) y lo rechaza con
    400; ver post_pipeline_event para el evento que SI entiende ese webhook."""
    if not webhook or not webhook.get("url"):
        return
    secret = os.environ["PITCH_MODAL_WEBHOOK_SECRET"]
    body = {"jobId": job_id, "phase": phase, "result": result}
    _sign_and_post(webhook["url"], secret, body)


def post_pipeline_event(webhook: dict, run_id: str, ok: bool, *, payload: dict | None = None,
                        artifacts: dict | list | None = None, snapshot_hash: str | None = None,
                        error: str | None = None) -> None:
    """Evento de fase 'pitch' para el pipeline unificado (api/pipeline/webhook.js
    + api/_lib/pipeline/process.js), que esperan {runId,phase,ok,...} — shape
    distinto al contrato M1 de post_webhook ({jobId,phase,result}). Mismo
    esquema HMAC que post_webhook (mismo secreto PITCH_MODAL_WEBHOOK_SECRET,
    mismos headers X-Modal-Timestamp/X-Modal-Signature, ver _sign_and_post)
    para que verifyModalSignature del backend lo acepte tal cual."""
    secret = os.environ["PITCH_MODAL_WEBHOOK_SECRET"]
    body: dict = {"runId": run_id, "phase": "pitch", "ok": ok}
    if payload is not None:
        body["payload"] = payload
    if artifacts is not None:
        body["artifacts"] = artifacts
    if snapshot_hash is not None:
        body["snapshotHash"] = snapshot_hash
    if error is not None:
        body["error"] = error[:300]
    _sign_and_post(webhook["url"], secret, body)


def artifact(kind: str, storage_uri: str, mime: str, meta: dict | None = None) -> dict:
    return {"kind": kind, "storage_uri": storage_uri, "mime": mime, "meta": meta or {}}
