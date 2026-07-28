# modal/spikes/transkun_piano.py
"""SPIKE (no producción): piano.mp3 → MIDI con Transkun.
Uso: modal run spikes/transkun_piano.py --piano-mp3 <ruta local del stem piano>
Imprime la ruta local del .mid resultante para evaluación en un DAW."""
import pathlib
import modal

app = modal.App("hkn-spike-transkun")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("transkun", "torch==2.4.1", "torchaudio==2.4.1")
)


@app.function(image=image, gpu="T4", timeout=600)
def transcribe(piano_bytes: bytes) -> bytes:
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(piano_bytes)
        src = f.name
    out = src.replace(".mp3", ".mid")
    subprocess.run(["transkun", src, out], check=True)
    return pathlib.Path(out).read_bytes()


@app.local_entrypoint()
def main(piano_mp3: str) -> None:
    midi = transcribe.remote(pathlib.Path(piano_mp3).read_bytes())
    out_path = pathlib.Path(piano_mp3).with_suffix(".transkun.mid")
    out_path.write_bytes(midi)
    print(f"MIDI: {out_path}")
