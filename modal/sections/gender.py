# modal/sections/gender.py
"""
S4 — separación de voces por género (male / female).

Pasos:
  1. Re-extraer el stem vocal desde el audio original (input.getUrl) usando
     extract_vocals_stem() de _common.py (BS-RoFormer ep_317).
  2. Correr chorus_bs_roformer (ep_267, SDR 24.13) sobre el vocal con overlap=16
     → produce male.mp3 / female.mp3.
  3. Subir male/female a los signed PUT URLs de uploads["gender"]["male"/"female"].
  4. Reportar section="gender", status="done".

TODO (A/B futuro — NO implementado):
  Alternativa 'aufr33' → bs_roformer_male_female_by_aufr33_sdr_7.2889.ckpt.
  Esperar escucha crítica A/B de Samu (go/no-go pendiente) antes de cambiar el
  modelo por defecto. Si se aprueba, cambiar S4_GENDER_MODEL y ajustar el
  checkpoint en run_gender(). Patrón análogo al TODO de 'ensemble' en extract.py.
"""

from __future__ import annotations

import os
import tempfile

# ── Constante del modelo de separación por género ────────────────────────────
# 'chorus_bs_roformer' → model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt (validado en PoC v2).
# 'aufr33'            → bs_roformer_male_female_by_aufr33_sdr_7.2889.ckpt
#                       (TODO: rama alternativa A/B — ver docstring de módulo arriba).
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


def run_gender(payload: dict) -> None:
    """
    Nodo S4: re-extrae el stem vocal, corre chorus_bs_roformer con overlap=16,
    sube male.mp3 / female.mp3 a los signed PUT URLs y postea el webhook.

    Re-extrae el vocal desde payload["input"]["getUrl"] (no usa vocals_key para
    descargar) porque Modal no tiene la service-role key de Supabase para firmar
    un GET del objeto ya subido por S1. Patrón idéntico al de S3 (medley_vox.py).

    En caso de excepción postea un webhook "failed" y propaga.
    """
    # Imports dentro de la función para que el import-time no falle fuera del
    # contenedor Modal (igual que en extract.py y medley_vox.py).
    from audio_separator.separator import Separator  # solo en el contenedor

    from sections._common import (
        extract_storage_key,
        extract_vocals_stem,
        post_webhook,
        upload_put,
    )

    if S4_GENDER_MODEL != "chorus_bs_roformer":
        raise NotImplementedError(
            f"S4_GENDER_MODEL={S4_GENDER_MODEL!r} no soportado; "
            "solo 'chorus_bs_roformer' (rama 'aufr33' = TODO A/B futuro, ver docstring)"
        )

    job_id: str = payload["jobId"]
    get_url: str = payload["input"]["getUrl"]
    uploads_g: dict = payload["uploads"].get("gender", {})
    webhook: dict = payload["webhook"]

    try:
        # ── 1. Re-extraer vocal con BS-RoFormer ep_317 ───────────────────────
        # extract_vocals_stem descarga get_url y produce vocals.mp3 con
        # output_single_stem="Vocals". Patrón idéntico al de S3.
        vocals_path: str = extract_vocals_stem(get_url)

        # ── 2. chorus_bs_roformer con overlap=16 → male / female ─────────────
        # overlap se pasa via mdxc_params (parámetro MDXC del Separator). Igual
        # que en el PoC v2 (separate_by_gender_v2 en poc_gender.py).
        # SUPUESTO: audio-separator ≥ 0.28 acepta mdxc_params con 'overlap' para
        # modelos chorus_bs_roformer; si la versión del contenedor no lo soporta
        # el Separator lanzará un error descriptivo en load_model/separate.
        gender_out = tempfile.mkdtemp()
        sep = Separator(
            output_dir=gender_out,
            output_format="mp3",
            mdxc_params={
                "segment_size": 256,
                "override_model_segment_size": False,
                "batch_size": 1,
                "overlap": _GENDER_OVERLAP,
                "pitch_shift": 0,
            },
        )
        sep.load_model(model_filename=_CHORUS_MODEL_CKPT)
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

        # ── 3. Subir male/female + recopilar storage keys ────────────────────
        outputs: dict[str, str] = {}
        for track in ("male", "female"):
            put_url = uploads_g.get(track)
            if not put_url:
                # SUPUESTO: el contrato del payload siempre incluye ambas keys
                # (male y female) en uploads["gender"]. Si falta una se omite de
                # outputs sin lanzar (igual al patrón de extract.py con tracks opcionales).
                continue
            upload_put(put_url, stems[track])
            outputs[track] = extract_storage_key(put_url)

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
