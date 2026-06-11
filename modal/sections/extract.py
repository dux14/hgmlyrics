# modal/sections/extract.py
"""
S1 — extracción de stems con demucs htdemucs_6s.

htdemucs_6s produce 6 pistas: vocals / drums / bass / guitar / piano / other.
La pista `instrumental` se construye como suma de las 5 pistas no vocales
(drums + bass + guitar + piano + other) usando pydub.

Phase 1 swapará S1_EXTRACTOR por "bs_roformer_ep_317" para mejor separación vocal.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import tempfile

# ── Constante de extractor ───────────────────────────────────────────────────
# Phase 1: cambiar por "bs_roformer_ep_317" (ver feat/estudio-fase1-*).
S1_EXTRACTOR = "htdemucs_6s"

# Pistas que produce htdemucs_6s (sin `instrumental` — la derivamos).
_DEMUCS_STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]

# Pistas que reportamos al webhook / que el front espera para voiceInstrumental.
_OUTPUT_STEMS = _DEMUCS_STEMS + ["instrumental"]


def _mix_non_vocal_stems(stem_dir: pathlib.Path, out_path: pathlib.Path) -> None:
    """
    Suma drums+bass+guitar+piano+other en un solo MP3 (= instrumental).
    Usa ffmpeg amix para no añadir pydub como dependencia.
    """
    non_vocal = [stem_dir / f"{s}.mp3" for s in _DEMUCS_STEMS if s != "vocals"]
    # ffmpeg amix normaliza por número de entradas; usamos sum con dropout_transition=0
    inputs_args = []
    for p in non_vocal:
        inputs_args.extend(["-i", str(p)])
    filter_graph = f"amix=inputs={len(non_vocal)}:duration=longest:dropout_transition=0:normalize=0"
    subprocess.run(
        ["ffmpeg", "-y", *inputs_args, "-filter_complex", filter_graph, str(out_path)],
        check=True,
    )


def run_extract(payload: dict) -> None:
    """
    Nodo S1: descarga el audio de entrada, corre demucs htdemucs_6s,
    sube las 7 pistas (vocals/drums/bass/guitar/piano/other/instrumental)
    a los signed PUT URLs de `uploads["voiceInstrumental"]`, y postea
    el webhook de la sección.

    En caso de excepción posta un webhook `failed` para voiceInstrumental
    y propaga la excepción (Modal lo registrará como fallo de la función).
    """
    # Import aquí para evitar que el import-time falle fuera del contenedor Modal.
    import httpx  # noqa: F401 — ya disponible en la imagen
    # Absolute import: cuando Modal ejecuta, `modal/` es el cwd y `sections` es top-level.
    from sections._common import extract_storage_key, upload_put, post_webhook

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

        # ── 2. Correr demucs ─────────────────────────────────────────────────
        out_dir = tempfile.mkdtemp()
        subprocess.run(
            [
                "python", "-m", "demucs",
                "-n", S1_EXTRACTOR,
                "--mp3",
                "-o", out_dir,
                src_path,
            ],
            check=True,
            env={**os.environ, "HF_HOME": "/root/.cache/huggingface"},
        )

        stem_dir = (
            pathlib.Path(out_dir) / S1_EXTRACTOR / pathlib.Path(src_path).stem
        )

        # ── 3. Derivar instrumental ──────────────────────────────────────────
        instrumental_path = stem_dir / "instrumental.mp3"
        _mix_non_vocal_stems(stem_dir, instrumental_path)

        # ── 4. Subir pistas + recopilar keys ────────────────────────────────
        outputs: dict[str, str] = {}
        for track in _OUTPUT_STEMS:
            put_url = uploads_vi.get(track)
            if not put_url:
                # La sección no incluyó este track en sus uploads; omitir.
                continue
            file_path = stem_dir / f"{track}.mp3"
            if not file_path.exists():
                raise FileNotFoundError(
                    f"demucs no produjo el stem esperado: {file_path}"
                )
            upload_put(put_url, str(file_path))
            # La key se extrae del signed PUT URL (la misma que usó start.js
            # para firmar: `{userId}/{jobId}/voiceInstrumental/{track}.mp3`).
            outputs[track] = extract_storage_key(put_url)

        # ── 5. Webhook de éxito ──────────────────────────────────────────────
        post_webhook(
            webhook,
            job_id,
            section="voiceInstrumental",
            result={
                "status": "done",
                "model": S1_EXTRACTOR,
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
                result={"status": "failed", "model": S1_EXTRACTOR, "outputs": {}},
                error=str(exc)[:400],
            )
        except Exception:
            pass  # si el webhook en sí falla, al menos no enmascaramos el error original
        raise
