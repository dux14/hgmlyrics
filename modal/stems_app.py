# modal/stems_app.py
"""
Orquestador DAG del Estudio de pistas — HKN Lyrics.

DAG (Task 9 — paralelización total, ver plan_sections en run_pipeline):
  S1 (extract ep_317+htdemucs_6s)
  S2 (structure SongFormer)
  S3 (leadBacking Mel-RoFormer Karaoke)
  S4 (gender chorus_bs_roformer, flag OFF)
  S5 (duet MedleyVox, opt-in)

  Las 5 se lanzan JUNTAS, en una sola fase, sin dependencia S1→(S3,S4,S5):
  S3/S4/S5 re-extraen su propio stem vocal del audio original, nunca
  consumieron la salida de S1 (solo recibían vocals_key por compatibilidad
  de firma). Antes arrancaban en una Fase B tras esperar a S1, lo que
  causaba progresividad (las pistas aparecían de a una en el front).

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
from sections.gender import run_gender as _run_gender_impl
from sections.lead_backing import run_lead_backing as _run_lead_backing_impl
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
    # git: requerido para instalar `asteroid` desde git+https (requirements.txt)
    # y para el `git clone` del WebUI de MedleyVox más abajo.
    .apt_install("ffmpeg", "git")
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

# Imagen DEDICADA de S2 (SongFormer). NO se comparte con S1/S3/S4 porque su stack
# (repo ASLP-lab/SongFormer + submódulos MuQ/musicfm + pesos) es pesado e
# independiente. Verificada con smoke_s2.py (build + inferencia GPU en verde:
# intro/verso/coro). Mismo hash que smoke_s2.py → `modal deploy` reusa las capas.
songformer_image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "ffmpeg", "build-essential")
    .run_commands(
        "git clone --recursive https://github.com/ASLP-lab/SongFormer.git /opt/songformer",
        "pip install -r /opt/songformer/requirements.txt",
        "pip install httpx==0.27.2",  # _common.py (download/post_webhook); no en su requirements
        "cd /opt/songformer/src/SongFormer && python utils/fetch_pretrained.py",
    )
    # librosa: infer.py del repo SongFormer ya lo trae transitivamente (carga
    # el audio a 24kHz con el), pero ahora run_songformer TAMBIEN lo usa
    # directo (sections/beats.py, deteccion de bpm/beats) -- se pinea
    # explicito para no depender de una version transitiva sin garantia.
    # Misma version que modal/requirements.txt (imagen de align_app.py/stems).
    .pip_install("librosa==0.10.2")
    .add_local_python_source("sections")
)

# Imagen del ENDPOINT HTTP (`start`). Solo valida el payload y hace
# `.spawn()` de run_pipeline, asi que no necesita nada de `image` (demucs,
# MedleyVox, etc.): con la imagen pesada, un endpoint frio tardaba mas de 8s
# solo en levantar, el POST de dispatch de Vercel abortaba por timeout y la
# fase quedaba 'failed' mientras la GPU ya estaba procesando -- trabajo
# pagado y tirado (mismo incidente que align_app.py, 27-jul-2026).
#
# Que lleva y por que: fastapi para el decorador de endpoint, y
# add_local_python_source("sections") porque stems_app importa
# `sections._common`/`extract`/`gender`/`lead_backing`/`medley_vox`/
# `songformer` a nivel de MODULO -- el contenedor del endpoint carga el
# archivo entero aunque solo ejecute `start`. Ninguno de esos modulos de
# `sections` importa nada pesado (torch/demucs/httpx) a nivel de modulo, asi
# que la imagen liviana alcanza para que el import global resuelva.
dispatch_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]")
    .add_local_python_source("sections")
)

# Sólo necesitamos el secret de webhook en el orquestador principal.
# S1 accede a él a través del payload; el secret de Supabase ya no hace falta
# porque usamos signed PUT URLs pre-firmadas por Vercel (sin service role key).
_webhook_secrets = [
    modal.Secret.from_name("hkn-webhook"),  # MODAL_INBOUND_SECRET, MODAL_WEBHOOK_SECRET
]

# Dict persistente para idempotencia por jobId (jobId -> callId de run_pipeline).
# Mismo patron que modal/pitch/pitch_app.py::_seen: sin esto, un timeout del
# POST de confirm.js (el job SI pudo haber arrancado en Modal) hace que el
# reintento con el mismo jobId lance un SEGUNDO run_pipeline sobre las mismas
# storage keys (fix CRITICAL 2, auditoria de pipeline 27-jul).
_seen = modal.Dict.from_name("stems-jobs-seen", create_if_missing=True)


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
# S2 — estructura (SongFormer, GPU L4)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=songformer_image, secrets=_webhook_secrets, gpu="L4", timeout=900)
def s2_structure(payload: dict) -> None:
    """
    S2: segmentacion de estructura musical con SongFormer (ASLP-lab).

    Descarga el audio, infiere segmentos {label, start, end} con SongFormer,
    normaliza las etiquetas a espanol y postea el webhook `structure`.
    NO sube audio (S2 solo produce metadatos de estructura).

    Timeout aumentado a 300 s (vs 60 del stub) para dar margen a la descarga
    del modelo desde HuggingFace en el primer cold start.

    GPU L4 (24 GiB), no T4 (16 GiB): infer.py de SongFormer corre el track
    ENTERO en una pasada, sin ventaneo por lotes, asi que el pico de memoria
    escala con la duracion. En T4 una cancion de 6:27 murio con
    "CUDA out of memory. Tried to allocate 5.58 GiB" (~20 GiB de pico
    necesarios) mientras las de <=4:53 pasaban -- fallo silencioso, porque
    infer.py se traga la excepcion del worker y sale con rc=0 (ver
    sections/songformer.py). 24 GiB cubren el catalogo real con margen; una
    cancion de mas de ~8 min volveria a quedarse corta y necesitaria
    ventanear la inferencia, no solo mas GPU.
    """
    _run_songformer_impl(payload)


# ──────────────────────────────────────────────────────────────────────────────
# S3 — lead / backing (Mel-RoFormer Karaoke, GPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, gpu="T4", timeout=600)
def s3_lead_backing(payload: dict, vocals_key: str | None) -> None:
    """
    S3: separa voz líder (lead) y coros (backing) con Mel-RoFormer Karaoke
    (checkpoint elegido en Task 4, SDR ~10.2, reemplaza a MedleyVox SDR ~6.9).

    Re-extrae el stem vocal desde el audio original (payload["input"]["getUrl"])
    porque Modal no tiene la service-role key de Supabase para firmar un GET
    del objeto ya subido por S1. vocals_key se recibe por compatibilidad con el
    spawn del orquestador pero NO se usa para descargar audio.

    Timeout: bajado de 900 a 600 s — el checkpoint karaoke se resuelve como
    cualquier otro modelo de audio-separator (sin descarga de pesos vía
    huggingface_hub ni carga de asteroid/TDConvNet), cold start más corto que
    MedleyVox. Sigue dando margen a extracción vocal BS-RoFormer (~120 s) +
    inferencia karaoke (~60-120 s en T4).
    """
    _run_lead_backing_impl(payload)


# ──────────────────────────────────────────────────────────────────────────────
# S5 — dúo por identidad de cantante (MedleyVox, GPU, opt-in)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, gpu="T4", timeout=900)
def s5_duet(payload: dict, vocals_key: str | None) -> None:
    """
    S5 (opt-in): separacion de DUOS por identidad de cantante con MedleyVox
    (Cyru5/MedleyVox "vocals 238"). A diferencia de S3 (karaoke: lead vs
    backing por rol), MedleyVox separa dos cantantes simultaneos (p. ej.
    hombre+mujer cantando juntos). Solo corre si "duet" esta en
    enabledSections. Reusa run_medley_vox (sube a uploads["duet"]).
    """
    _run_medley_vox_impl(payload, section="duet", labels=("voice_a", "voice_b"))


# ──────────────────────────────────────────────────────────────────────────────
# S4 — separación de voces por género (chorus_bs_roformer, GPU)
# ──────────────────────────────────────────────────────────────────────────────

@app.function(image=image, secrets=_webhook_secrets, gpu="T4", timeout=1200)
def s4_gender(payload: dict, vocals_key: str | None) -> None:
    """
    S4: separa la voz en male.mp3 / female.mp3 con chorus_bs_roformer (ep_267,
    SDR 24.13) y overlap=16.

    Re-extrae el stem vocal desde payload["input"]["getUrl"] usando
    extract_vocals_stem() de _common.py (BS-RoFormer ep_317). vocals_key se
    recibe por compatibilidad con el spawn del orquestador pero NO se usa para
    descargar audio (Modal no tiene la service-role key de Supabase).

    Timeout: 1200 s — overlap=16 ~duplica el tiempo del paso de género vs el
    default (overlap=8); igual que separate_by_gender_v2 en poc_gender.py.

    Solo se activa si "gender" está en enabledSections. El flag STUDIO_GENDER_FLAG
    controla si "gender" aparece en enabled (ver api/stems/jobs/[id]/start.js).
    HOY el flag está OFF; este nodo no corre en producción.
    """
    _run_gender_impl(payload)


# ──────────────────────────────────────────────────────────────────────────────
# Orquestador principal
# ──────────────────────────────────────────────────────────────────────────────

def plan_sections(enabled: list[str]) -> list[str]:
    """
    Plan PURO (sin I/O, sin Modal) de qué secciones lanzar en la fase inicial
    ÚNICA del DAG (Task 9 — paralelización total).

    Antes: Fase A (S1+S2) → esperar S1 → Fase B (S3/S4/S5, dependían de la
    vocals_key de S1). Eso causaba progresividad (las pistas aparecían de a
    una) y era una dependencia FALSA: S3/S4/S5 re-extraen su propio stem
    vocal desde el audio original (ver docstrings de s3_lead_backing,
    s4_gender, s5_duet más arriba) — nunca usaron vocals_key para descargar
    audio, solo la recibían por compatibilidad de firma.

    Ahora: TODAS las secciones habilitadas se lanzan juntas, en una sola
    fase. S1 (voiceInstrumental) corre siempre, sin importar `enabled`
    (mismo criterio que ENABLED_SECTIONS en
    api/songs/[id]/pipeline/_dispatch.js); S2/S3/S4/S5 solo si están en
    `enabled`.
    """
    sections = ["voiceInstrumental"]
    for key in ("structure", "leadBacking", "gender", "duet"):
        if key in enabled:
            sections.append(key)
    return sections


@app.function(image=image, secrets=_webhook_secrets, timeout=1200)
def run_pipeline(payload: dict) -> None:
    """
    Orquestador DAG de las secciones del Estudio.

    DAG (Task 9 — paralelización total, ver plan_sections): TODAS las
    secciones habilitadas se lanzan en una fase inicial única. Ya no hay
    dependencia S1→(S3,S4,S5): esas 3 re-extraen su propia vocal del audio
    original, no consumen la salida de S1.

    Cada nodo postea su webhook de forma independiente; un fallo en un nodo
    no cancela los demás (Modal registra el error en el log del nodo).
    """
    enabled: list[str] = payload.get("enabledSections", [])
    sections = plan_sections(enabled)

    # vocals_key: se mantiene la firma s3/s4/s5(payload, vocals_key) por
    # compatibilidad, pero ahora siempre es None (ya no se espera a S1 antes
    # de spawnear el resto) — ninguno de los 3 la usa para descargar audio.
    vocals_key: str | None = None

    spawners = {
        "voiceInstrumental": lambda: s1_extract.spawn(payload),
        "structure": lambda: s2_structure.spawn(payload),
        "leadBacking": lambda: s3_lead_backing.spawn(payload, vocals_key),
        "gender": lambda: s4_gender.spawn(payload, vocals_key),
        "duet": lambda: s5_duet.spawn(payload, vocals_key),
    }
    calls = [spawners[section]() for section in sections]

    # Esperar a que todas terminen (para que el orquestador no muera antes de
    # que posteen sus webhooks; Modal cobra mientras el contenedor está
    # vivo). S3 (karaoke) puede tardar hasta ~600 s; el orquestador tiene
    # timeout=1200 s de margen.
    for call in calls:
        try:
            call.get(timeout=950)
        except Exception:
            pass  # cada nodo ya posteó su propio webhook de fallo


# ──────────────────────────────────────────────────────────────────────────────
# Web endpoint — recibe la invocación de Vercel
# ──────────────────────────────────────────────────────────────────────────────

def _validate_stems_payload(payload: dict) -> str | None:
    """Valida el payload ANTES de lanzar run_pipeline. Devuelve un mensaje de
    error (string) si falta algo requerido, o None si es válido. Mismo
    patrón que _validate_align_payload (align_app.py): un dispatch
    malformado que pasara igual no dejaría rastro hasta que el contenedor
    arrancara y fallara adentro — validar aquí, antes del .spawn(), evita
    crear ese job huérfano (el caller, invokeModalPipeline en
    api/_lib/modal.js, recibe un 400 inmediato).

    Contrato de payload (ver api/_lib/modal.js): { jobId, input:{getUrl},
    enabledSections, uploads, webhook:{url,secret} }."""
    if not payload.get("jobId"):
        return "falta jobId"
    if not payload.get("input", {}).get("getUrl"):
        return "falta input.getUrl"
    if not payload.get("uploads"):
        return "uploads vacio o ausente"
    if not payload.get("webhook"):
        return "falta webhook"
    return None


@app.function(image=dispatch_image, secrets=_webhook_secrets)
@modal.fastapi_endpoint(method="POST")
def start(payload: dict, x_inbound_secret: str = Header(default="")):
    """
    Punto de entrada HTTP para el orquestador.

    Verifica el header `x-inbound-secret` contra MODAL_INBOUND_SECRET, valida
    el payload (400 si falta algo requerido) y lanza el pipeline de forma
    asíncrona (.spawn), devolviendo el callId inmediatamente para no
    bloquear el request de Vercel.

    Idempotencia (mismo patron que modal/pitch/pitch_app.py::start): si el
    jobId ya fue lanzado, NO relanza run_pipeline (evita dos escrituras
    concurrentes sobre las mismas storage keys) y devuelve el callId
    cacheado con `dedup: true`. `payload.reset=true` fuerza un run nuevo y
    sobrescribe el cache -- reservado para un reintento deliberado del
    admin, ya serializado por su propio CAS.

    Respuesta: { "callId": "<modal call object_id>", "dedup"?: true }
    """
    if not hmac.compare_digest(
        x_inbound_secret,
        os.environ.get("MODAL_INBOUND_SECRET", ""),
    ):
        raise HTTPException(status_code=401, detail="bad inbound secret")

    validation_error = _validate_stems_payload(payload)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    job_id = payload["jobId"]
    if not payload.get("reset") and job_id in _seen:
        return {"callId": _seen[job_id], "dedup": True}

    call = run_pipeline.spawn(payload)
    _seen[job_id] = call.object_id
    return {"callId": call.object_id}


def _validate_structure_payload(payload: dict) -> str | None:
    """Valida el payload de un dispatch de S2 en solitario, ANTES de lanzar
    s2_structure. Paralelo a _validate_stems_payload, pero SIN exigir
    `uploads`: S2 no sube nada, y ese requisito es justo lo que impide
    reusar `start` para reintentar solo la fase de estructura."""
    if not payload.get("jobId"):
        return "falta jobId"
    if not payload.get("input", {}).get("getUrl"):
        return "falta input.getUrl"
    if not payload.get("webhook"):
        return "falta webhook"
    return None


@app.function(image=dispatch_image, secrets=_webhook_secrets)
@modal.fastapi_endpoint(method="POST")
def structure(payload: dict, x_inbound_secret: str = Header(default="")):
    """
    Punto de entrada HTTP para reintentar SOLO la fase S2 (SongFormer), sin
    correr el pipeline completo. Mismo patrón que `start`/`transcribe`.

    Idempotencia: usa el mismo Dict `_seen` que `start`, pero con clave
    prefijada `structure:<jobId>` -- el jobId que llega acá es el MISMO
    runId que ya usó `start`, y sin el prefijo colisionaría con la entrada
    de `start` (el retry de structure no spawnearía nada). `payload.reset`
    fuerza un run nuevo, igual que en `start`.

    Respuesta: { "callId": "<modal call object_id>", "dedup"?: true }
    """
    if not hmac.compare_digest(
        x_inbound_secret,
        os.environ.get("MODAL_INBOUND_SECRET", ""),
    ):
        raise HTTPException(status_code=401, detail="bad inbound secret")

    validation_error = _validate_structure_payload(payload)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    seen_key = f"structure:{payload['jobId']}"
    if not payload.get("reset") and seen_key in _seen:
        return {"callId": _seen[seen_key], "dedup": True}

    call = s2_structure.spawn(payload)
    _seen[seen_key] = call.object_id
    return {"callId": call.object_id}
