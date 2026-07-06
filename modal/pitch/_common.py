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


def post_webhook(webhook: dict, job_id: str, phase: str, result: dict) -> None:
    """Contrato M1 (INMUTABLE): body={"jobId","phase","result"}.
    result={"ok":bool,"error"?:str,"artifacts"?:[{kind,storage_uri,mime,meta?}],"cost"?:float}.
    Design B: firma con PITCH_MODAL_WEBHOOK_SECRET del entorno (NO del payload).
    Firma: hex(hmac_sha256(secret, f"{ts}.{body_str}")), headers
    X-Modal-Timestamp/X-Modal-Signature. Lanza en non-2xx."""
    import httpx
    secret = os.environ["PITCH_MODAL_WEBHOOK_SECRET"]
    body_str = json.dumps({"jobId": job_id, "phase": phase, "result": result})
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), f"{ts}.{body_str}".encode(), hashlib.sha256).hexdigest()
    r = httpx.post(webhook["url"], content=body_str,
                   headers={"Content-Type": "application/json", "X-Modal-Timestamp": ts,
                            "X-Modal-Signature": sig}, timeout=30)
    r.raise_for_status()


def artifact(kind: str, storage_uri: str, mime: str, meta: dict | None = None) -> dict:
    return {"kind": kind, "storage_uri": storage_uri, "mime": mime, "meta": meta or {}}
