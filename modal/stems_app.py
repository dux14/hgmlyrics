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
    if not url.startswith(("http://", "https://")):
        url = "https://" + url  # la integración Supabase-Vercel guarda el host sin scheme
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


STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]

@app.function(image=image, secrets=secrets, gpu="T4", timeout=900)
def run_demucs(audio_url: str, job_id: str, user_id: str, callback_url: str):
    import subprocess
    try:
        src = _download(audio_url)
        out_dir = tempfile.mkdtemp()
        # htdemucs_6s = 6 stems; mp3 para storage liviano (igual que Replicate)
        subprocess.run(
            ["python", "-m", "demucs", "-n", "htdemucs_6s", "--mp3", "-o", out_dir, src],
            check=True, env={**os.environ, "HF_HOME": "/root/.cache/huggingface"},
        )
        base = pathlib.Path(out_dir) / "htdemucs_6s" / pathlib.Path(src).stem
        output = {}
        for name in STEM_NAMES:
            f = base / f"{name}.mp3"
            if f.exists():
                output[name] = _upload_to_supabase(str(f), f"{user_id}/{job_id}/stems/{name}.mp3")
        _post_callback(callback_url, {"status": "succeeded", "output": output})
    except Exception as e:
        _post_callback(callback_url, {"status": "failed", "error": str(e)[:200]})
        raise


@app.function(image=image, secrets=secrets, gpu="T4", timeout=900)
def run_diarization(audio_url: str, job_id: str, user_id: str, callback_url: str):
    try:
        from pyannote.audio import Pipeline
        import torch
        src = _download(audio_url)
        pipe = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", use_auth_token=os.environ["HF_TOKEN"]
        )
        pipe.to(torch.device("cuda"))
        dia = pipe(src)
        segments = [
            {"speaker": label, "start": round(turn.start, 3), "stop": round(turn.end, 3)}
            for turn, _, label in dia.itertracks(yield_label=True)
        ]
        _post_callback(callback_url, {"status": "succeeded", "output": {"segments": segments}})
    except Exception as e:
        _post_callback(callback_url, {"status": "failed", "error": str(e)[:200]})
        raise


@app.function(image=image, secrets=secrets, gpu="T4", timeout=900)
def run_mdx23(audio_url: str, job_id: str, user_id: str, callback_url: str):
    # TODO(B4): MDX23 no es pip-installable. Hay que vendorizar el repo que usa
    # `lucataco/mvsep-mdx23-music-separation` (revisar su cog.yaml/predict.py) + sus pesos
    # en la imagen (image.run_commands / image.add_local_dir, versiones fijadas), correr la
    # inferencia, subir lead.mp3/backing.mp3 a `{user_id}/{job_id}/voices/` y postear el callback
    # con {"output": {"lead": key, "backing": key}}.
    # VÁLVULA: hasta entonces, mantener STEMS_PROVIDER_KARAOKE=replicate en Vercel; karaoke
    # nunca se despacha a Modal, así que este stub no se invoca en producción.
    _post_callback(callback_url, {"status": "failed", "error": "run_mdx23 no implementado todavía (ver TODO B4)"})
    raise NotImplementedError("run_mdx23 pendiente: vendorizar MDX23. Usar STEMS_PROVIDER_KARAOKE=replicate.")


DISPATCH = {"stems": run_demucs, "karaoke": run_mdx23, "diarization": run_diarization}

@app.function(image=image, secrets=secrets)
@modal.fastapi_endpoint(method="POST")
def start(payload: dict, x_inbound_secret: str = Header(default="")):
    if not hmac.compare_digest(x_inbound_secret, os.environ.get("MODAL_INBOUND_SECRET", "")):
        raise HTTPException(status_code=401, detail="bad inbound secret")
    kind = payload.get("kind")
    fn = DISPATCH.get(kind)
    if fn is None:
        raise HTTPException(status_code=400, detail="bad kind")
    call = fn.spawn(payload["audioUrl"], payload["jobId"], payload["userId"], payload["callbackUrl"])
    return {"callId": call.object_id}
