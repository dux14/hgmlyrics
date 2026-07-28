# modal/sections/gender.py
"""
S4 — separación de voces por género (male / female), UN solo modelo.

Pasos:
  1. Re-extraer el stem vocal desde el audio original (input.getUrl) usando
     extract_vocals_stem() de _common.py (BS-RoFormer ep_317).
  2. Correr chorus_bs_roformer (ep_267, SDR 24.13) con overlap=16 → male/female.
  3. Subir cada stem a uploads["gender"]["chorus"][track] (estructura anidada).
  4. Reportar section="gender", status="done",
     outputs={ "chorus": {male, female} }.

Nota histórica: existió una rama alternativa 'aufr33'
(bs_roformer_male_female_by_aufr33) evaluada en A/B contra chorus_bs_roformer.
El probe de checkpoints de audio-separator 0.28.5 no encontró ningún Mel-Band
RoFormer male/female de aufr33 disponible, así que se eliminó esa rama
(quedó solo chorus_bs_roformer, ya validado en PoC v2).
"""

from __future__ import annotations

import os
import tempfile

# ── Constante del modelo de separación por género ────────────────────────────
# 'chorus_bs_roformer' → model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt (validado en PoC v2).
S4_GENDER_MODEL = "chorus_bs_roformer"

# Checkpoint de chorus_bs_roformer validado en PoC v2.
_CHORUS_MODEL_CKPT = "model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt"

# Overlap subido a 16 (vs default 8) para mayor promediado entre chunks →
# split de género más limpio, a costa de ~2x tiempo. Validado en PoC v2 (GENDER_OVERLAP_V2=16).
_GENDER_OVERLAP = 16


def _classify_stem(filename: str) -> "str | None":
    """Mapea el nombre de archivo de un stem a 'male' o 'female'.

    audio-separator produce nombres del tipo:
      vocals_(Female)_model_chorus_bs_roformer_ep_267....mp3
      vocals_(Male)_model_chorus_bs_roformer_ep_267....mp3

    IMPORTANTE: 'female' contiene 'male' como substring, por lo que SIEMPRE
    se chequea 'female' primero. Devuelve None si no se reconoce el género
    (el llamador lanzará RuntimeError en ese caso).
    """
    low = filename.lower()
    if "female" in low:
        return "female"
    if "male" in low:
        return "male"
    return None


def separate_by_gender(
    vocals_path: str,
    model_ckpt: str = _CHORUS_MODEL_CKPT,
    overlap: int = _GENDER_OVERLAP,
) -> dict:
    """
    Inferencia PURA de S4 sobre una pista vocal local.

    Corre el modelo de separación por género indicado (default
    chorus_bs_roformer ep_267, SDR 24.13, con overlap=16) sobre `vocals_path` y
    devuelve un dict con la ruta local de cada stem:

      { "male": <path>, "female": <path> }

    Los args `model_ckpt`/`overlap` tienen los defaults de producción, de modo
    que run_gender (que llama sin argumentos) conserva su comportamiento exacto.

    NO re-extrae el vocal, NO sube nada, NO postea webhook. El llamador es
    responsable de los archivos temporales.
    """
    from audio_separator.separator import Separator  # solo en el contenedor

    # overlap se pasa via mdxc_params (parámetro MDXC del Separator). Igual
    # que en el PoC v2 (separate_by_gender_v2 en poc_gender.py).
    gender_out = tempfile.mkdtemp()
    sep = Separator(
        output_dir=gender_out,
        output_format="mp3",
        mdxc_params={
            "segment_size": 256,
            "override_model_segment_size": False,
            "batch_size": 1,
            "overlap": overlap,
            "pitch_shift": 0,
        },
    )
    sep.load_model(model_filename=model_ckpt)
    out_files = sep.separate(vocals_path)

    # Clasificar los stems producidos en male/female.
    stems: dict[str, str] = {}
    for fname in out_files:
        fpath = fname if os.path.isabs(fname) else os.path.join(gender_out, fname)
        label = _classify_stem(os.path.basename(fpath))
        if label is None:
            raise RuntimeError(
                "chorus_bs_roformer produjo un stem inesperado "
                f"(no contiene 'male' ni 'female'): {os.path.basename(fpath)}"
            )
        stems[label] = fpath

    for required in ("male", "female"):
        if required not in stems:
            raise RuntimeError(
                f"chorus_bs_roformer no produjo el stem requerido '{required}'. "
                f"Stems presentes: {list(stems.keys())}"
            )
    return stems


def run_gender(payload: dict) -> None:
    """
    Nodo S4: re-extrae el stem vocal, corre chorus_bs_roformer con overlap=16,
    sube el par male/female a su slot en uploads["gender"]["chorus"] y postea
    un webhook con outputs anidados por modelo (queda un solo modelo, pero se
    conserva la forma anidada por compatibilidad con el contrato existente).

    Contrato del webhook (status=done):
      {
        "status": "done",
        "model": "chorus_bs_roformer",
        "outputs": {
          "chorus": {"male": <storageKey>, "female": <storageKey>}
        }
      }

    Re-extrae el vocal desde payload["input"]["getUrl"] porque Modal no tiene la
    service-role key de Supabase para firmar un GET del objeto de S1.
    Patrón idéntico al de S3 (medley_vox.py).

    Aislamiento por modelo: si el (único) modelo falla se registra su error y
    se propaga (postea el webhook failed antes de relanzar el error).
    """
    # Imports dentro de la función para que el import-time no falle fuera del
    # contenedor Modal (igual que en extract.py y medley_vox.py).
    from sections._common import (
        extract_storage_key,
        extract_vocals_stem,
        post_webhook,
        upload_put,
    )

    job_id: str = payload["jobId"]
    get_url: str = payload["input"]["getUrl"]
    uploads_g: dict = payload["uploads"].get("gender", {})
    webhook: dict = payload["webhook"]

    # Definición del modelo de producción (rama aufr33 eliminada, ver docstring
    # de módulo). Se conserva la lista para no tocar la lógica de aislamiento
    # de errores de abajo.
    # Cada entrada: (label_en_outputs, model_ckpt)
    MODELS = [
        ("chorus", _CHORUS_MODEL_CKPT),
    ]

    try:
        # ── 1. Re-extraer vocal con BS-RoFormer ep_317 (UNA sola vez) ────────
        # extract_vocals_stem descarga get_url y produce vocals.mp3 con
        # output_single_stem="Vocals". Patrón idéntico al de S3.
        vocals_path: str = extract_vocals_stem(get_url)

        # ── 2. Correr cada modelo; aislar errores por modelo ──────────────────
        outputs: dict[str, dict[str, str]] = {}
        model_errors: list[tuple[str, Exception]] = []

        for model_label, model_ckpt in MODELS:
            model_uploads = uploads_g.get(model_label, {})
            try:
                stems = separate_by_gender(vocals_path, model_ckpt=model_ckpt)

                model_outputs: dict[str, str] = {}
                for track in ("male", "female"):
                    put_url = model_uploads.get(track)
                    if not put_url:
                        # Si falta el PUT URL para este track, se omite sin lanzar.
                        continue
                    upload_put(put_url, stems[track])
                    model_outputs[track] = extract_storage_key(put_url)

                outputs[model_label] = model_outputs

            except Exception as model_exc:
                # Registrar el error pero seguir con el siguiente modelo.
                model_errors.append((model_label, model_exc))

        # ── 3. Evaluar resultado global ───────────────────────────────────────
        # Con un solo modelo en MODELS, esto equivale a "el modelo falló";
        # se conserva la forma genérica por si en el futuro vuelve a haber
        # más de un modelo en la lista.
        if len(model_errors) == len(MODELS):
            raise RuntimeError(
                "El modelo de género falló. "
                + "; ".join(f"{lbl}: {exc}" for lbl, exc in model_errors)
            )

        # ── 4. Webhook de éxito ──────────────────────────────────────────────
        post_webhook(
            webhook,
            job_id,
            section="gender",
            result={
                "status": "done",
                "model": "chorus_bs_roformer",
                "outputs": outputs,
            },
        )

    except Exception as exc:
        # Postear fallo antes de propagar para que el front no quede esperando.
        try:
            post_webhook(
                webhook,
                job_id,
                section="gender",
                result={
                    "status": "failed",
                    "model": "chorus_bs_roformer",
                    "outputs": {},
                },
                error=str(exc)[:400],
            )
        except Exception:
            pass  # si el webhook en sí falla, no enmascaramos el error original
        raise
