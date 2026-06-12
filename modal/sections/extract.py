# modal/sections/extract.py
"""
S1 — extracción de stems con BS-RoFormer ep_317 (vocal/instrumental) +
     demucs htdemucs_6s (drums/bass/guitar/piano/other).

Pasos:
  1. BS-RoFormer ep_317 sobre la mezcla original  →  vocals + instrumental
     (model_bs_roformer_ep_317_sdr_12.9755.ckpt vía audio-separator).
  2. Demucs htdemucs_6s sobre la mezcla original  →  drums/bass/guitar/piano/other
     (la pista `vocals` de demucs se descarta; se usa la de ep_317).
  3. Subir las 7 keys: vocals, instrumental, drums, bass, guitar, piano, other.
  4. Reportar model='bs_roformer_ep_317+htdemucs_6s', status='done'.

TODO (upgrade futuro): extractor 'ensemble' — combinar ep_317 con MVSEP-MDX23c
  o similar para mayor SDR en mezclas con mucho reverb. NO implementar aún;
  esperar evaluación auditiva de ep_317 en producción.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import tempfile

# ── Constante de extractor ───────────────────────────────────────────────────
# 'ep_317'  → BS-RoFormer ep_317 (vocal) + htdemucs_6s (percusión/bajo/etc.)
# 'ensemble' → TODO: upgrade (ver docstring de módulo arriba). No implementado.
S1_EXTRACTOR = "ep_317"

# Modelo BS-RoFormer para separación vocal.
_BS_ROFORMER_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"

# Pistas de percusión/melodía que extraemos de demucs htdemucs_6s.
# La pista `vocals` de demucs se descarta (usamos la de ep_317).
_DEMUCS_INSTRUMENT_STEMS = ["drums", "bass", "guitar", "piano", "other"]

# Pistas que reportamos al webhook / que el front espera para voiceInstrumental.
_OUTPUT_STEMS = ["vocals", "instrumental"] + _DEMUCS_INSTRUMENT_STEMS


def _classify_ep317_stem(filename: str) -> "str | None":
    """
    Mapea el nombre de archivo de un stem de ep_317 a 'vocals' o 'instrumental'.

    audio-separator produce nombres del tipo:
      song_(Vocals)_model_bs_roformer_ep_317_sdr_12.9755.ckpt.mp3
      song_(Instrumental)_model_bs_roformer_ep_317_sdr_12.9755.ckpt.mp3

    Devuelve None si el nombre no es reconocido (el llamador lanzará).
    """
    low = filename.lower()
    if "(vocals)" in low:
        return "vocals"
    if "(instrumental)" in low:
        return "instrumental"
    return None


def run_extract(payload: dict) -> None:
    """
    Nodo S1: descarga el audio de entrada, corre BS-RoFormer ep_317 (vocals +
    instrumental) y demucs htdemucs_6s (drums/bass/guitar/piano/other), sube
    las 7 pistas a los signed PUT URLs de `uploads["voiceInstrumental"]`, y
    postea el webhook de la sección.

    En caso de excepción posta un webhook `failed` para voiceInstrumental
    y propaga la excepción (Modal lo registrará como fallo de la función).
    """
    # Import aquí para evitar que el import-time falle fuera del contenedor Modal.
    import httpx  # noqa: F401 — ya disponible en la imagen
    # Absolute import: cuando Modal ejecuta, `modal/` es el cwd y `sections` es top-level.
    from sections._common import extract_storage_key, upload_put, post_webhook
    from audio_separator.separator import Separator  # noqa: E402 — solo en el contenedor

    _MODEL_LABEL = "bs_roformer_ep_317+htdemucs_6s"

    job_id: str = payload["jobId"]
    get_url: str = payload["input"]["getUrl"]
    uploads_vi: dict = payload["uploads"].get("voiceInstrumental", {})
    webhook: dict = payload["webhook"]

    try:
        # ── 1. Descargar audio de entrada ────────────────────────────────────
        fd, src_path = tempfile.mkstemp(suffix=".audio")
        os.close(fd)
        with httpx.stream("GET", get_url, timeout=120, follow_redirects=True) as r:
            r.raise_for_status()
            with open(src_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)

        # ── 2. BS-RoFormer ep_317: vocals + instrumental ─────────────────────
        # Separamos ambos stems (sin output_single_stem) para obtener
        # vocals e instrumental del mismo paso.
        ep317_out = tempfile.mkdtemp()
        ep317_sep = Separator(output_dir=ep317_out, output_format="mp3")
        ep317_sep.load_model(model_filename=_BS_ROFORMER_MODEL)
        ep317_files = ep317_sep.separate(src_path)

        ep317_stems: dict[str, str] = {}
        for fname in ep317_files:
            fpath = fname if os.path.isabs(fname) else os.path.join(ep317_out, fname)
            label = _classify_ep317_stem(os.path.basename(fpath))
            if label is None:
                raise RuntimeError(
                    f"ep_317 produjo un stem inesperado: {os.path.basename(fpath)}"
                )
            ep317_stems[label] = fpath

        for required in ("vocals", "instrumental"):
            if required not in ep317_stems:
                raise RuntimeError(
                    f"ep_317 no produjo el stem requerido '{required}'. "
                    f"Stems presentes: {list(ep317_stems.keys())}"
                )

        # ── 3. Demucs htdemucs_6s: drums/bass/guitar/piano/other ────────────
        demucs_out = tempfile.mkdtemp()
        subprocess.run(
            [
                "python", "-m", "demucs",
                "-n", "htdemucs_6s",
                "--mp3",
                "-o", demucs_out,
                src_path,
            ],
            check=True,
            env={**os.environ, "HF_HOME": "/root/.cache/huggingface"},
        )

        demucs_stem_dir = (
            pathlib.Path(demucs_out) / "htdemucs_6s" / pathlib.Path(src_path).stem
        )

        # Verificar que los stems instrumentales de demucs existen.
        for stem in _DEMUCS_INSTRUMENT_STEMS:
            p = demucs_stem_dir / f"{stem}.mp3"
            if not p.exists():
                raise FileNotFoundError(
                    f"demucs htdemucs_6s no produjo el stem esperado: {p}"
                )

        # ── 4. Subir pistas + recopilar keys ────────────────────────────────
        outputs: dict[str, str] = {}

        # vocals e instrumental vienen de ep_317
        for track in ("vocals", "instrumental"):
            put_url = uploads_vi.get(track)
            if not put_url:
                continue
            upload_put(put_url, ep317_stems[track])
            outputs[track] = extract_storage_key(put_url)

        # drums/bass/guitar/piano/other vienen de demucs
        for track in _DEMUCS_INSTRUMENT_STEMS:
            put_url = uploads_vi.get(track)
            if not put_url:
                continue
            file_path = demucs_stem_dir / f"{track}.mp3"
            upload_put(put_url, str(file_path))
            outputs[track] = extract_storage_key(put_url)

        # ── 5. Webhook de éxito ──────────────────────────────────────────────
        post_webhook(
            webhook,
            job_id,
            section="voiceInstrumental",
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
                section="voiceInstrumental",
                result={
                    "status": "failed",
                    "model": "bs_roformer_ep_317+htdemucs_6s",
                    "outputs": {},
                },
                error=str(exc)[:400],
            )
        except Exception:
            pass  # si el webhook en sí falla, al menos no enmascaramos el error original
        raise
