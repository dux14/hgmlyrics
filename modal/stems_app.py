# modal/stems_app.py
"""
Orquestador DAG del Estudio de pistas — HKN Lyrics.

DAG:
  S1 (extract ep_317+htdemucs_6s) ─┐
  S2 (structure SongFormer)  ├─ paralelo al inicio
                              │
  S3 (leadBacking MedleyVox) ┤ arranca cuando S1 termina (necesita vocals key)
  S4 (gender stub)      ──────┘ arranca cuando S1 termina (idem)

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
from sections.medley_vox import run_medley_vox as _run_medley_vox_impl
from sections.songformer import run_songformer as _run_songformer_impl


# ──────────────────────────────────────────────────────────────────────────────
# App + imagen
# ──────────────────────────────────────────────────────────────────────────────

app = modal.App("hkn-stems")

# Imagen GPU: necesaria para S1 (demucs) y S3 (MedleyVox Conv-TasNet STFT).
# S2/S4 también corren en esta imagen para simplificar el despliegue.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install_from_requirements("requirements.txt")
    # MedleyVox WebUI: clonamos el repo de inferencia para obtener los módulos
    # `models/`, `functions/`, y `utils/` que usa run_medley_vox en tiempo de
    # ejecución (asteroid_filterbanks + TDConvNet + loudnorm utils).
    # SUPUESTO: el repo SUC-DriverOld/MedleyVox-Inference-WebUI es compatible
    # con la versión de asteroid instalada vía requirements.txt (asteroid ≥ 0.4).
    .run_commands(
        "git clone --depth=1 https://github.com/SUC-DriverOld/MedleyVox-Inference-WebUI "
        "/opt/medleyvox-webui",
        "pip install pyloudnorm",  # no está en requirements.txt; solo lo necesita S3
    )
    .env({"PYTHONPATH": "/opt/medleyvox-webui"})
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
# S1 — extracción de stems (GPU, ep_317+htdemucs_6s)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, gpu="T4", timeout=900)
def s1_extract(payload: dict) -> str | None:
    """
    Descarga audio, corre BS-RoFormer ep_317 (vocals/instrumental) + demucs
    htdemucs_6s (drums/bass/guitar/piano/other), sube las 7 pistas y postea
    webhook voiceInstrumental.

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
# S2 — estructura (SongFormer, CPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, gpu="T4", timeout=900)
def s2_structure(payload: dict) -> None:
    """
    S2: segmentacion de estructura musical con SongFormer (ASLP-lab).

    Descarga el audio, infiere segmentos {label, start, end} con SongFormer,
    normaliza las etiquetas a espanol y postea el webhook `structure`.
    NO sube audio (S2 solo produce metadatos de estructura).

    Timeout aumentado a 300 s (vs 60 del stub) para dar margen a la descarga
    del modelo desde HuggingFace en el primer cold start.
    """
    _run_songformer_impl(payload)


# ──────────────────────────────────────────────────────────────────────────────
# S3 — lead / backing (MedleyVox real, GPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, gpu="T4", timeout=900)
def s3_lead_backing(payload: dict, vocals_key: str | None) -> None:
    """
    S3: separa voz líder (lead) y coros (backing) con MedleyVox.

    Usa el checkpoint Cyru5/MedleyVox@"vocals 238" (Conv-TasNet STFT, 24 kHz).
    Re-extrae el stem vocal desde el audio original (payload["input"]["getUrl"])
    porque Modal no tiene la service-role key de Supabase para firmar un GET
    del objeto ya subido por S1. vocals_key se recibe por compatibilidad con el
    spawn del orquestador pero NO se usa para descargar audio.

    Timeout: 900 s para dar margen a la descarga de pesos desde HuggingFace
    (~466 MB vocals.pth) en cold start + extracción vocal BS-RoFormer (~120 s)
    + inferencia MedleyVox (~60-120 s en T4).
    """
    _run_medley_vox_impl(payload)


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
    s2_call = s2_structure.spawn(payload) if "structure" in enabled else None

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
        s3_lead_backing.spawn(payload, vocals_key)
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
    # S3 (MedleyVox) puede tardar hasta ~900 s en cold start (descarga de pesos
    # + extracción vocal + inferencia); el orquestador tiene timeout=1200 s.
    for call in (s3_call, s4_call):
        if call is not None:
            try:
                call.get(timeout=950)
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
