# modal/smoke_s2.py
"""
Smoke AISLADO de S2 (SongFormer) — construye e itera la imagen DEDICADA del
repo ASLP-lab/SongFormer (clone --recursive + submodulos MuQ/musicfm + pesos)
SIN tocar la app de produccion `hkn-stems`.

Por que aislado: `modal deploy stems_app.py` construye TODAS las imagenes a la
vez; un build roto de SongFormer bloquearia re-deployar S1/S3/S4. Aqui iteramos
el build hasta que pase; cuando este verde, el MISMO `songformer_image` se copia
a stems_app.py y `modal deploy` reusa las capas cacheadas (mismo hash → sin
rebuild).

Recorta el audio a 60 s para abaratar la iteracion GPU (la estructura de un
clip corto basta para validar que la inferencia corre y emite segmentos).

Uso:
  cd modal && python3 -m modal run smoke_s2.py --mp3 /Users/samu/Downloads/huracan.mp3
"""

from __future__ import annotations

import os
import tempfile

import modal

# ── Imagen DEDICADA de SongFormer (receta verificada vs repo real) ───────────
# Submodulos: src/third_party/MuQ (tencent-ailab/MuQ), src/third_party/musicfm
# (minzwon/musicfm). Pesos via utils/fetch_pretrained.py (cwd-relative ckpts/).
songformer_image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "ffmpeg", "build-essential")
    .run_commands(
        "git clone --recursive https://github.com/ASLP-lab/SongFormer.git /opt/songformer",
        "pip install -r /opt/songformer/requirements.txt",
        # httpx lo necesita nuestro _common.py (download/post_webhook); no esta
        # en el requirements del repo.
        "pip install httpx==0.27.2",
        # Pesos: fetch_pretrained.py corre SIN args y baja a ckpts/ relativo al
        # cwd → hay que pararse en src/SongFormer.
        "cd /opt/songformer/src/SongFormer && python utils/fetch_pretrained.py",
    )
    .add_local_python_source("sections")
)

app = modal.App("hkn-stems-s2-smoke")


@app.function(image=songformer_image, gpu="T4", timeout=1800)
def s2_only(name: str, audio_bytes: bytes) -> dict:
    """Corre SongFormer sobre un clip de 60 s y devuelve los segmentos ES."""
    import subprocess

    from sections.songformer import _run_inference, _normalize_label

    fd, src = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    with open(src, "wb") as f:
        f.write(audio_bytes)

    # Recortar a 60 s para acelerar la inferencia del smoke.
    fd2, clip = tempfile.mkstemp(suffix=".wav")
    os.close(fd2)
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-t", "60", "-ac", "1", "-ar", "24000", clip],
        check=True,
        capture_output=True,
    )

    print(f"[{name}] S2 — SongFormer infer sobre clip 60s…")
    raw = _run_inference(clip)
    segments = [
        {"label": _normalize_label(s["label"]), "start": s["start"], "end": s["end"]}
        for s in raw
    ]
    print(f"[{name}] S2 OK — {len(segments)} segmentos")
    return {"name": name, "segments": segments}


@app.local_entrypoint()
def main(mp3: str = "/Users/samu/Downloads/huracan.mp3"):
    import json

    name = os.path.splitext(os.path.basename(mp3))[0]
    with open(mp3, "rb") as f:
        audio = f.read()

    print(f"Despachando smoke S2 de «{name}» ({len(audio) / 1e6:.1f} MB)…")
    res = s2_only.remote(name, audio)

    segs = res["segments"]
    print(f"\nOK — S2 emitio {len(segs)} segmentos:")
    for i, s in enumerate(segs, start=1):
        print(f"  {i:>2}. {s['label']:<12} {s['start']:>7.2f}s → {s['end']:>7.2f}s")
    print("\nJSON:", json.dumps(segs, ensure_ascii=False))
