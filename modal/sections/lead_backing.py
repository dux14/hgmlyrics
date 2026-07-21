# modal/sections/lead_backing.py
"""
S3 — separación de voz líder (lead) y coros (backing) con Mel-RoFormer Karaoke.

Reemplaza a MedleyVox (SDR ~6.9, ver sections/medley_vox.py, que se conserva
sin uso para la Task 12 — separación de dúos). Checkpoint elegido en Task 4
(mel_band_roformer_karaoke_aufr33_viperx, SDR ~10.2 en leaderboard MVSEP).

Arquitectura (mismo contrato de webhook que sections/medley_vox.py):
  1. Re-extrae el stem vocal desde el audio original con BS-RoFormer ep_317
     (vía el helper extract_vocals_stem de _common.py).
  2. Corre el checkpoint karaoke (audio-separator) sobre ese vocal: produce
     dos fuentes etiquetadas por nombre de archivo, "(Vocals)" = voz líder y
     "(Instrumental)" = resto del stem vocal (coros/backing) — a diferencia de
     MedleyVox, el modelo karaoke ya distingue lead de backing por diseño, sin
     heurística de energía RMS.
  3. Sube lead y backing a los signed PUT URLs de `uploads["leadBacking"]`.
  4. Postea webhook section="leadBacking", result={"status":"done",...}.

Ventaja operativa sobre MedleyVox: no requiere descargar pesos desde
HuggingFace (huggingface_hub) ni cargar asteroid/TDConvNet — el checkpoint
karaoke se resuelve como cualquier otro modelo de audio-separator, igual
patrón que _extract_vocals_from_path en _common.py. Cold start más corto.
"""

from __future__ import annotations

import os
import re
import tempfile

# Checkpoint elegido en Task 4. Rollback por env var, igual patrón que
# VOCAL_MODEL_CKPT (extracción de vocal, Task 5).
_KARAOKE_MODEL_CKPT = os.environ.get(
    "KARAOKE_MODEL_CKPT",
    "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt",
)

# Etiqueta de modelo reportada en webhooks (nombre del checkpoint sin extensión).
_MODEL_LABEL = _KARAOKE_MODEL_CKPT.removesuffix(".ckpt")


def _classify_karaoke_stem(filename: str) -> "str | None":
    """Mapea el nombre de archivo de un stem del modelo karaoke a 'lead' o
    'backing'. El input de este modelo ya es el stem vocal extraído en el
    paso anterior (extract_vocals_stem), cuyo nombre de archivo trae de
    fábrica el prefijo '(vocals)'. audio-separator agrega SU PROPIA etiqueta
    al final del nombre ('(Vocals)' o '(Instrumental)'/'(other)' según el
    checkpoint), por lo que ambos stems producidos por el karaoke contienen
    '(vocals)' en algún punto del nombre y no se puede clasificar por simple
    contención. Por eso se decide por la ÚLTIMA etiqueta entre paréntesis
    (la que agrega el karaoke): si esa última etiqueta menciona 'vocals' es
    lead, si no, es backing (el modelo produce EXACTAMENTE 2 stems)."""
    tags = re.findall(r"\(([^)]*)\)", filename.lower())
    last = tags[-1] if tags else ""
    return "lead" if "vocals" in last else "backing"


def separate_lead_backing(vocals_path: str) -> dict:
    """
    Inferencia PURA del modelo karaoke sobre una pista vocal local.

    Carga el checkpoint _KARAOKE_MODEL_CKPT vía audio-separator, separa la voz
    en lead/backing (etiquetado por nombre de archivo, no por heurística RMS)
    y transcodifica a MP3 (mismo output_format que MedleyVox). NO sube nada ni
    postea webhook.

    Devuelve: { "lead": <path>, "backing": <path> }.

    Reusado por run_lead_backing (producción) y por el smoke de S3
    (validación local, diferido), de modo que la lógica que Samu escucha es
    exactamente la desplegada. El llamador es responsable de borrar los mp3
    temporales.
    """
    from audio_separator.separator import Separator  # solo en el contenedor

    out_dir = tempfile.mkdtemp()
    sep = Separator(output_dir=out_dir, output_format="mp3")
    sep.load_model(model_filename=_KARAOKE_MODEL_CKPT)
    out_files = sep.separate(vocals_path)

    stems: dict[str, str] = {}
    for fname in out_files:
        fpath = fname if os.path.isabs(fname) else os.path.join(out_dir, fname)
        label = _classify_karaoke_stem(os.path.basename(fpath))
        stems[label] = fpath

    for required in ("lead", "backing"):
        if required not in stems:
            raise RuntimeError(
                f"karaoke no produjo el stem requerido '{required}'. "
                f"Stems presentes: {list(stems.keys())}"
            )
    return stems


def run_lead_backing(payload: dict) -> None:
    """
    Nodo S3: separa voz líder y coros de la pista vocal con Mel-RoFormer Karaoke.

    Flujo (idéntico al de run_medley_vox, solo cambia el modelo de separación):
      1. Re-extrae vocal desde el audio original (get_url del payload).
      2. Inferencia karaoke → lead / backing (etiquetado por nombre de archivo).
      3. Sube ambas pistas con upload_put.
      4. Postea webhook leadBacking.

    En excepción postea webhook failed y re-lanza (Modal registra el fallo).
    """
    # Helpers canónicos del orquestador.
    from sections._common import (
        extract_storage_key,
        extract_vocals_stem,
        post_webhook,
        upload_put,
    )

    job_id: str = payload["jobId"]
    uploads_lb: dict = payload.get("uploads", {}).get("leadBacking", {})
    webhook: dict = payload["webhook"]

    try:
        # ── 1. Re-extraer stem vocal desde el audio original ─────────────────
        # extract_vocals_stem descarga get_url internamente (ver _common.py).
        vocals_path = extract_vocals_stem(payload["input"]["getUrl"])

        # ── 2. Inferencia karaoke (lead/backing por etiqueta del modelo) ─────
        stems = separate_lead_backing(vocals_path)

        # ── 3. Subir pistas y recopilar keys ─────────────────────────────────
        # Incluye el vocal intermedio (pre-karaoke): es la única fuente de
        # `tracks.vocals` del pipeline unificado (voiceInstrumental no sube
        # nada en este modo, ver STEM_KINDS en songs/[id]/pipeline/_dispatch.js).
        outputs: dict[str, str] = {}
        for track, tmp_path in (("lead", stems["lead"]), ("backing", stems["backing"]), ("vocals", vocals_path)):
            put_url = uploads_lb.get(track)
            if not put_url:
                # SUPUESTO: si no hay PUT URL para la pista (leadBacking no habilitado,
                # o flujo legacy del Estudio sin slot 'vocals'), se omite en silencio.
                continue
            upload_put(put_url, tmp_path, content_type="audio/mpeg")
            outputs[track] = extract_storage_key(put_url)

        # Limpiar mp3 temporales.
        for tmp in (stems["lead"], stems["backing"], vocals_path):
            try:
                os.unlink(tmp)
            except OSError:
                pass

        # ── 4. Webhook de éxito ──────────────────────────────────────────────
        post_webhook(
            webhook,
            job_id,
            section="leadBacking",
            result={
                "status": "done",
                "model": _MODEL_LABEL,
                "outputs": outputs,
            },
        )

    except Exception as exc:
        # Postear fallo antes de propagar para que el front no quede esperando.
        try:
            post_webhook(
                webhook,
                job_id,
                section="leadBacking",
                result={
                    "status": "failed",
                    "model": _MODEL_LABEL,
                    "outputs": {},
                },
                error=str(exc)[:400],
            )
        except Exception:
            pass  # si el webhook en sí falla, no enmascaramos el error original
        raise
