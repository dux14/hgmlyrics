# modal/sections/_common.py
"""Utilidades compartidas por todos los nodos del DAG de secciones."""

# `modal deploy` importa este módulo bajo el Python local (3.9), que no soporta
# la sintaxis de unión `X | None` (PEP 604, 3.10+). Diferir la evaluación de
# anotaciones lo hace compatible.
from __future__ import annotations

import hashlib
import hmac
import json
import time
import pathlib
from urllib.parse import urlparse

# NOTA: `httpx` solo existe dentro de la imagen Modal, no en el entorno local que
# evalúa el módulo durante `modal deploy`. Por eso se importa DENTRO de las
# funciones (que corren en el contenedor), no a nivel de módulo: de lo contrario
# `from sections._common import ...` en stems_app.py rompería el deploy local.


# ──────────────────────────────────────────────────────────────────────────────
# Storage
# ──────────────────────────────────────────────────────────────────────────────

STEMS_BUCKET = "stems-jobs"


def extract_storage_key(signed_put_url: str) -> str:
    """
    Extrae la storage key de un signed PUT URL de Supabase Storage.

    El formato del URL es:
      https://<project>.supabase.co/storage/v1/object/upload/sign/<bucket>/<key>?token=...

    Devuelve el <key> (p.ej. `<userId>/<jobId>/voiceInstrumental/vocals.mp3`).
    Lanza ValueError si el URL no tiene el formato esperado.
    """
    path = urlparse(signed_put_url).path  # /storage/v1/object/upload/sign/<bucket>/<key>
    marker = f"/object/upload/sign/{STEMS_BUCKET}/"
    idx = path.find(marker)
    if idx == -1:
        raise ValueError(
            f"No se pudo extraer la storage key del URL (bucket '{STEMS_BUCKET}' no encontrado): {signed_put_url[:120]}"
        )
    return path[idx + len(marker):]


def upload_put(put_url: str, file_path: str, content_type: str = "audio/mpeg") -> None:
    """HTTP PUT del archivo al signed URL. Lanza en non-2xx."""
    import httpx  # disponible en la imagen Modal (ver nota arriba)

    data = pathlib.Path(file_path).read_bytes()
    r = httpx.put(
        put_url,
        content=data,
        headers={"Content-Type": content_type},
        timeout=180,
    )
    r.raise_for_status()


# ──────────────────────────────────────────────────────────────────────────────
# Webhook
# ──────────────────────────────────────────────────────────────────────────────

def post_webhook(
    webhook: dict,
    job_id: str,
    section: str,
    result: dict | None = None,
    error: str | None = None,
) -> None:
    """
    Postea una notificación firmada al webhook de Vercel.

    Contrato de firma (debe coincidir con verifyModalSignature en modal.js):
      - Serializar el payload con json.dumps UNA SOLA VEZ → body_str.
      - ts = str(int(time.time()))   (unix seconds)
      - message = f"{ts}.{body_str}"
      - sig = hmac.new(webhook["secret"].encode(), message.encode(), sha256).hexdigest()
      - Header X-Modal-Timestamp: ts
      - Header X-Modal-Signature: sig  (hex lowercase)

    El receptor rechaza si abs(now_ms - ts*1000) >= 300_000 (±5 min),
    por lo que siempre se usa un timestamp fresco.

    Lanza en non-2xx. El llamador puede capturar para que un webhook
    fallido no cancele las demás secciones.
    """
    import httpx  # disponible en la imagen Modal (ver nota arriba)

    payload: dict = {
        "jobId": job_id,
        "section": section,
        "result": result if result is not None else {},
        "error": error,
    }

    # Serializar una sola vez; sign y send el mismo string exacto.
    body_str: str = json.dumps(payload)
    ts: str = str(int(time.time()))

    sig: str = hmac.new(
        webhook["secret"].encode(),
        f"{ts}.{body_str}".encode(),
        hashlib.sha256,
    ).hexdigest()

    r = httpx.post(
        webhook["url"],
        content=body_str,
        headers={
            "Content-Type": "application/json",
            "X-Modal-Timestamp": ts,
            "X-Modal-Signature": sig,
        },
        timeout=30,
    )
    r.raise_for_status()
