# modal/smoke_s3.py
"""
Smoke de S3 (MedleyVox) — corre el MISMO path desplegado sobre canciones reales
y devuelve lead/backing mp3 a disco local, para que Samu valide a oído los
SUPUESTOS de medley_vox.py (sobre todo «lead = mayor RMS» y el checkpoint Cyru5).

NO toca producción: es una app efímera (`modal run`), distinta de `hkn-stems`.
Reusa la imagen y los helpers reales (sections._common._extract_vocals_from_path
+ sections.medley_vox.separate_lead_backing), así que la inferencia es idéntica
a la de prod. La imagen comparte hash con el orquestador → capas cacheadas.

Uso:
  cd modal && python3 -m modal run smoke_s3.py
"""

from __future__ import annotations

import os

import modal

# Misma definición de imagen que stems_app.py (mismo hash → reusa cache).
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install_from_requirements("requirements.txt")
    .run_commands(
        "git clone --depth=1 https://github.com/SUC-DriverOld/MedleyVox-Inference-WebUI "
        "/opt/medleyvox-webui",
        "pip install pyloudnorm",
    )
    .env({"PYTHONPATH": "/opt/medleyvox-webui"})
    .add_local_python_source("sections")
)

app = modal.App("hkn-stems-s3-smoke")

# Rutas locales (este repo). El local_entrypoint corre en la máquina de Samu.
_SONGS_DIR = (
    "/Users/samu/code/personal/Mark-N-Hkl/hgmlyrics/.claude/worktrees/"
    "feat+estudio-f1-gender-poc/modal/poc-songs"
)
_OUT_DIR = "/Users/samu/code/personal/Mark-N-Hkl/estudio-escucha/s3"
_SONGS = ["colombia", "ocupatetudetodo", "tuyasson"]


@app.function(image=image, gpu="T4", timeout=900)
def smoke(name: str, original_bytes: bytes) -> dict:
    """
    Corre ep_317 (extracción vocal) + MedleyVox (lead/backing) sobre el audio
    original y devuelve los mp3 como bytes + las energías RMS asignadas.
    """
    import tempfile

    # Helpers REALES del pipeline desplegado.
    from sections._common import _extract_vocals_from_path
    from sections.medley_vox import separate_lead_backing

    fd, src = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    with open(src, "wb") as f:
        f.write(original_bytes)

    vocals_path = _extract_vocals_from_path(src)   # BS-RoFormer ep_317
    sep = separate_lead_backing(vocals_path)        # MedleyVox + asignación RMS

    with open(sep["lead_mp3"], "rb") as f:
        lead = f.read()
    with open(sep["backing_mp3"], "rb") as f:
        backing = f.read()

    return {
        "name": name,
        "lead": lead,
        "backing": backing,
        "rms_lead": sep["rms_lead"],
        "rms_backing": sep["rms_backing"],
    }


@app.local_entrypoint()
def main():
    import json

    # Cargar originales y despachar en paralelo (starmap = 1 contenedor por canción).
    arg_tuples = []
    for name in _SONGS:
        with open(f"{_SONGS_DIR}/{name}.mp3", "rb") as f:
            arg_tuples.append((name, f.read()))

    rms_map: dict[str, dict] = {}
    for res in smoke.starmap(arg_tuples):
        name = res["name"]
        song_dir = f"{_OUT_DIR}/{name}"
        os.makedirs(song_dir, exist_ok=True)
        with open(f"{song_dir}/lead.mp3", "wb") as f:
            f.write(res["lead"])
        with open(f"{song_dir}/backing.mp3", "wb") as f:
            f.write(res["backing"])
        rms_map[name] = {
            "rms_lead": res["rms_lead"],
            "rms_backing": res["rms_backing"],
        }
        print(
            f"[{name}] lead RMS={res['rms_lead']:.4f}  backing RMS={res['rms_backing']:.4f}"
        )

    # Inyectar RMS en la página de escucha (window.__S3_RMS__).
    os.makedirs(_OUT_DIR, exist_ok=True)
    with open(f"{_OUT_DIR}/rms.js", "w") as f:
        f.write("window.__S3_RMS__ = " + json.dumps(rms_map) + ";\n")
    print("OK — escrito a", _OUT_DIR)
