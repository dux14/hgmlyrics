# modal/stems_app.py
"""
Orquestador DAG del Estudio de pistas — HKN Lyrics.

DAG:
  S1 (extract htdemucs_6s) ─┐
  S2 (structure stub)       ├─ paralelo al inicio
                             │
  S3 (leadBacking stub) ────┤ arranca cuando S1 termina (necesita vocals key)
  S4 (gender stub)    ──────┘ arranca cuando S1 termina (idem)

Cada nodo postea su propio webhook al terminar (éxito o fallo).
La Vercel API acumula los resultados en la columna `sections` del job.

NOTAS DE DESPLIEGUE
- `modal deploy` diferido a Task 0.10 (smoke test con credenciales reales).
- Los secrets Modal requeridos: hkn-webhook (MODAL_WEBHOOK_SECRET, MODAL_INBOUND_SECRET).
  Los secrets hkn-supabase y hkn-hf ya NO son necesarios en este orquestador
  (el upload se hace con signed PUT URLs pre-firmadas por Vercel).
"""

from __future__ import annotations

import hashlib
import hmac
import os

from fastapi import Header, HTTPException
import modal

# Absolute imports: Modal runs stems_app.py from the `modal/` directory,
# so `sections` is a top-level package relative to that working directory.
from sections._common import extract_storage_key, post_webhook
from sections.extract import run_extract as _run_extract_impl


# ──────────────────────────────────────────────────────────────────────────────
# App + imagen
# ──────────────────────────────────────────────────────────────────────────────

app = modal.App("hkn-stems")

# Imagen GPU: necesaria sólo para S1 (demucs). S2/S3/S4 son CPU stubs pero
# comparten la misma imagen para simplificar el despliegue en esta fase.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install_from_requirements("requirements.txt")
    # Modal 1.x ya no auto-monta los módulos locales hermanos: hay que incluir
    # explícitamente el paquete `sections` para que el contenedor pueda importarlo.
    .add_local_python_source("sections")
)

# Sólo necesitamos el secret de webhook en el orquestador principal.
# S1 accede a él a través del payload; el secret de Supabase ya no hace falta
# porque usamos signed PUT URLs pre-firmadas por Vercel (sin service role key).
_webhook_secrets = [
    modal.Secret.from_name("hkn-webhook"),  # MODAL_INBOUND_SECRET, MODAL_WEBHOOK_SECRET
]


# ──────────────────────────────────────────────────────────────────────────────
# S1 — extracción de stems (GPU, htdemucs_6s)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, gpu="T4", timeout=900)
def s1_extract(payload: dict) -> str | None:
    """
    Descarga audio, corre demucs htdemucs_6s, sube 7 pistas (vocals/drums/bass/
    guitar/piano/other/instrumental), postea webhook voiceInstrumental.

    Devuelve la storage key de `vocals` para que S3/S4 puedan referenciarla,
    o None si la sección falló.
    """
    _run_extract_impl(payload)
    # Recuperar la key de vocals de los uploads para pasarla a S3/S4.
    # Si run_extract lanzó, este código no se alcanza (la excepción sale).
    uploads_vi = payload.get("uploads", {}).get("voiceInstrumental", {})
    vocals_url = uploads_vi.get("vocals")
    if vocals_url:
        try:
            return extract_storage_key(vocals_url)
        except ValueError:
            return None
    return None


# ──────────────────────────────────────────────────────────────────────────────
# S2 — estructura (stub, CPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, timeout=60)
def s2_structure_stub(payload: dict) -> None:
    """
    Stub de S2: postea un resultado mínimo válido de estructura musical.
    Phase 1 reemplaza esto con SongFormer.

    Segmentos de ejemplo: intro (0–5 s) + verso (5–20 s).
    El front sólo necesita que `sections.structure.status` pase a "done".
    """
    job_id: str = payload["jobId"]
    webhook: dict = payload["webhook"]
    try:
        post_webhook(
            webhook,
            job_id,
            section="structure",
            result={
                "status": "done",
                "model": "stub",
                "segments": [
                    {"label": "intro", "start": 0.0, "end": 5.0},
                    {"label": "verso", "start": 5.0, "end": 20.0},
                ],
            },
        )
    except Exception as exc:
        # Intentar reportar el fallo; si el webhook mismo falla, loggear y seguir.
        try:
            post_webhook(
                webhook,
                job_id,
                section="structure",
                result={"status": "failed", "model": "stub", "segments": []},
                error=str(exc)[:400],
            )
        except Exception:
            pass
        raise


# ──────────────────────────────────────────────────────────────────────────────
# S3 — lead / backing (stub, CPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, timeout=60)
def s3_lead_backing_stub(payload: dict, vocals_key: str | None) -> None:
    """
    Stub de S3: postea un resultado mínimo válido de lead/backing.
    Phase 2 reemplaza esto con Medley Vox real.

    Decisión de diseño para el stub: NO sube audio real (lead/backing).
    En cambio reporta las keys que le corresponderían según los uploads
    pre-firmados, para que el contrato con el front quede ejercitado.
    Si no hay PUT URL para lead/backing, se reporta vocals_key como fallback.
    """
    job_id: str = payload["jobId"]
    webhook: dict = payload["webhook"]
    uploads_lb = payload.get("uploads", {}).get("leadBacking", {})

    def _key_for(track: str) -> str:
        url = uploads_lb.get(track)
        if url:
            try:
                return extract_storage_key(url)
            except ValueError:
                pass
        # Fallback: vocals_key o string vacío (el front ignorará si status=done/stub)
        return vocals_key or ""

    try:
        post_webhook(
            webhook,
            job_id,
            section="leadBacking",
            result={
                "status": "done",
                "model": "stub",
                "outputs": {
                    "lead": _key_for("lead"),
                    "backing": _key_for("backing"),
                },
            },
        )
    except Exception as exc:
        try:
            post_webhook(
                webhook,
                job_id,
                section="leadBacking",
                result={"status": "failed", "model": "stub", "outputs": {}},
                error=str(exc)[:400],
            )
        except Exception:
            pass
        raise


# ──────────────────────────────────────────────────────────────────────────────
# S4 — clasificación de género vocal (stub, CPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, timeout=60)
def s4_gender_stub(payload: dict, vocals_key: str | None) -> None:
    """
    Stub de S4: postea un resultado mínimo válido de clasificación de género.
    Phase 2 reemplaza esto con el clasificador real (ver feat/estudio-f1-gender-poc).

    Sólo se llama si "gender" está en enabledSections.
    """
    job_id: str = payload["jobId"]
    webhook: dict = payload["webhook"]
    uploads_g = payload.get("uploads", {}).get("gender", {})

    def _key_for(track: str) -> str:
        url = uploads_g.get(track)
        if url:
            try:
                return extract_storage_key(url)
            except ValueError:
                pass
        return vocals_key or ""

    try:
        post_webhook(
            webhook,
            job_id,
            section="gender",
            result={
                "status": "done",
                "model": "stub",
                "outputs": {
                    "male": _key_for("male"),
                    "female": _key_for("female"),
                },
            },
        )
    except Exception as exc:
        try:
            post_webhook(
                webhook,
                job_id,
                section="gender",
                result={"status": "failed", "model": "stub", "outputs": {}},
                error=str(exc)[:400],
            )
        except Exception:
            pass
        raise


# ──────────────────────────────────────────────────────────────────────────────
# Orquestador principal
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, timeout=1200)
def run_pipeline(payload: dict) -> None:
    """
    Orquestador DAG de las 4 secciones del Estudio.

    DAG:
      Fase A (paralelo): S1 (extract) + S2 (structure stub)
      Fase B (tras S1):  S3 (leadBacking stub) + S4 (gender stub, si habilitado)

    Cada nodo postea su webhook de forma independiente; un fallo en un nodo
    no cancela los demás (Modal registra el error en el log del nodo).

    Nota sobre S3/S4: si S1 lanza una excepción, el call de S1 también lanza
    y los nodos S3/S4 recibirán vocals_key=None. El stub igual postea un
    webhook done (con keys vacías) para que el front no quede esperando.
    """
    enabled: list[str] = payload.get("enabledSections", [])

    # ── Fase A: S1 y S2 en paralelo ─────────────────────────────────────────
    s1_call = s1_extract.spawn(payload)
    s2_call = s2_structure_stub.spawn(payload) if "structure" in enabled else None

    # Esperar S1 para obtener la vocals_key que necesitan S3 y S4.
    # s1_call.get() propaga la excepción si S1 falló; capturamos para no matar el pipeline.
    vocals_key: str | None = None
    try:
        vocals_key = s1_call.get()
    except Exception:
        # S1 ya posteó su webhook `failed`; continuamos para que S3/S4 también reporten.
        pass

    # Esperar S2 de forma no bloqueante (ya que la Fase B no depende de S2).
    if s2_call is not None:
        try:
            s2_call.get(timeout=60)
        except Exception:
            pass  # S2 ya posteó su webhook de fallo

    # ── Fase B: S3 y S4 (dependen de vocals_key de S1) ──────────────────────
    s3_call = (
        s3_lead_backing_stub.spawn(payload, vocals_key)
        if "leadBacking" in enabled
        else None
    )
    s4_call = (
        s4_gender_stub.spawn(payload, vocals_key)
        if "gender" in enabled
        else None
    )

    # Esperar a que S3/S4 terminen (para que el orquestador no muera antes de
    # que posteen sus webhooks; Modal cobra mientras el contenedor está vivo).
    for call in (s3_call, s4_call):
        if call is not None:
            try:
                call.get(timeout=120)
            except Exception:
                pass  # cada nodo ya posteó su propio webhook de fallo


# ──────────────────────────────────────────────────────────────────────────────
# Web endpoint — recibe la invocación de Vercel
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets)
@modal.fastapi_endpoint(method="POST")
def start(payload: dict, x_inbound_secret: str = Header(default="")):
    """
    Punto de entrada HTTP para el orquestador.

    Verifica el header `x-inbound-secret` contra MODAL_INBOUND_SECRET.
    Lanza el pipeline de forma asíncrona (.spawn) y devuelve el callId
    inmediatamente para no bloquear el request de Vercel.

    Respuesta: { "callId": "<modal call object_id>" }
    """
    if not hmac.compare_digest(
        x_inbound_secret,
        os.environ.get("MODAL_INBOUND_SECRET", ""),
    ):
        raise HTTPException(status_code=401, detail="bad inbound secret")

    call = run_pipeline.spawn(payload)
    return {"callId": call.object_id}
