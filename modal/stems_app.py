# modal/stems_app.py
import hashlib, hmac, json, os, time, pathlib, tempfile
from fastapi import Header, HTTPException
import modal

app = modal.App("hkn-stems")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install_from_requirements("requirements.txt")
)

# Secrets creados con `modal secret create` (ver Task B6).
secrets = [
    modal.Secret.from_name("hkn-supabase"),   # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    modal.Secret.from_name("hkn-hf"),          # HF_TOKEN
    modal.Secret.from_name("hkn-webhook"),     # MODAL_WEBHOOK_SECRET, MODAL_INBOUND_SECRET
]

def _upload_to_supabase(local_path: str, key: str, content_type: str = "audio/mpeg") -> str:
    """Sube un archivo al bucket privado stems-jobs con la service role key. Devuelve la key."""
    import httpx
    url = os.environ["SUPABASE_URL"]
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    data = pathlib.Path(local_path).read_bytes()
    r = httpx.post(
        f"{url}/storage/v1/object/stems-jobs/{key}",
        params={"upsert": "true"},
        headers={"Authorization": f"Bearer {service_key}", "Content-Type": content_type},
        content=data, timeout=120,
    )
    r.raise_for_status()
    return key

def _post_callback(callback_url: str, payload: dict) -> None:
    """POST firmado al webhook de Vercel: hex(hmac-sha256(`${ts}.${body}`))."""
    import httpx
    secret = os.environ["MODAL_WEBHOOK_SECRET"].encode()
    body = json.dumps(payload)
    ts = str(int(time.time()))
    sig = hmac.new(secret, f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    httpx.post(callback_url, content=body,
               headers={"Content-Type": "application/json", "x-modal-timestamp": ts, "x-modal-signature": sig},
               timeout=30)

def _download(audio_url: str) -> str:
    import httpx
    fd, path = tempfile.mkstemp(suffix=".audio")
    os.close(fd)
    with httpx.stream("GET", audio_url, timeout=120, follow_redirects=True) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return path
