# modal/checkpoints_probe.py
"""Inventario de modelos soportados por python-audio-separator en la imagen
de producción. Uso: modal run checkpoints_probe.py
Imprime los modelos cuyo nombre matchea los candidatos de la migración."""
import modal

# Imagen minima autocontenida: el catalogo de checkpoints depende solo de la
# version de audio-separator (misma que produccion, 0.28.5), no del GPU ni del
# resto de la imagen de stems. Importar `image` desde stems_app fallaba en el
# contenedor (Modal v1.x no monta stems_app como modulo remoto).
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("audio-separator[cpu]==0.28.5")
)

app = modal.App("hkn-checkpoints-probe")

CANDIDATES = [
    "polarformer",            # BS PolarFormer (tanda 1, vocal/instrumental)
    "mel_band_roformer",      # familia Mel-Band (varios)
    "melband",                # variantes de nombre
    "karaoke",                # lead/backing (tanda 2)
    "male_female",            # género (tanda 2)
    "bs_roformer",            # familia BS (referencia actual)
    "guitar",                 # instrumento dedicado (tanda 3)
    "piano",                  # instrumento dedicado (tanda 3)
]


@app.function(image=image, timeout=300)
def probe() -> None:
    from audio_separator.separator import Separator

    sep = Separator()
    models = sep.list_supported_model_files()
    flat = []
    for arch, entries in models.items():
        for friendly, meta in entries.items():
            fname = meta if isinstance(meta, str) else meta.get("filename", str(meta))
            flat.append((arch, friendly, str(fname)))
    for arch, friendly, fname in sorted(flat):
        low = f"{friendly} {fname}".lower()
        if any(c in low for c in CANDIDATES):
            print(f"[{arch}] {friendly} -> {fname}")


@app.local_entrypoint()
def main() -> None:
    probe.remote()


# ELEGIDOS (probe corrido 20-jul-2026, audio-separator 0.28.5):
#   vocal      = melband_roformer_big_beta4.ckpt
#                (alternativa a A/B de oido: melband_roformer_big_beta5e.ckpt;
#                 NO hay BS PolarFormer en esta version de audio-separator)
#   karaoke    = mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt
#   malefemale = NINGUNO Mel-Band male/female disponible -> Task 7 CASO B
#                (limpiar rama aufr33, conservar chorus_bs_roformer)
#   guitar     = NINGUNO checkpoint dedicado -> Task 11 CASO B (htdemucs_6s)
#   piano      = NINGUNO checkpoint dedicado -> Task 11 CASO B (htdemucs_6s)
