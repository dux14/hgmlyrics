# modal/sections/medley_vox.py
"""
S3 — separación de voz líder (lead) y coros (backing) con MedleyVox.

Arquitectura:
  1. Re-extrae el stem vocal desde el audio original con BS-RoFormer ep_317
     (vía el helper extract_vocals_stem de _common.py).
  2. Corre MedleyVox (Conv-TasNet STFT, checkpoint Cyru5/MedleyVox@vocals 238)
     sobre el vocal para obtener dos fuentes: output_1 (líder) y output_2 (coros).
  3. Sube lead y backing a los signed PUT URLs de `uploads["leadBacking"]`.
  4. Postea webhook section="leadBacking", result={"status":"done",...}.

Fuente de pesos: https://huggingface.co/Cyru5/MedleyVox (Cyru5, oct 2023).
  Cyru5 re-entrenó el modelo original de jeonchangbin49/MedleyVox porque los
  autores no publicaron sus pesos. El checkpoint "vocals 238" es el más maduro
  (238 épocas, mejor loss -9.809 @ epoch 235, dataset singing_librispeech).

Inferencia: basada en SUC-DriverOld/MedleyVox-Inference-WebUI/inference.py
  (MIT-compatible; lógica de separación sin overlapadd para simplicidad).

NOTA sobre el pipeline de asignación lead/backing:
  MedleyVox produce 2 fuentes sin una etiqueta explícita "líder" vs "coro".
  Se asigna lead = la fuente de mayor energía RMS (heurística estándar para
  voz principal vs acompañamiento en mezclas pop).
  SUPUESTO: mayor energía RMS ≡ voz líder. Esto es válido en la mayoría de
  canciones pop/reggaeton pero puede fallar en temas con coros muy potentes;
  Samu debe validar en el smoke test.
"""

from __future__ import annotations

# Modelo de pesos de Cyru5 en HuggingFace.
_HF_REPO = "Cyru5/MedleyVox"

# Nombre de la carpeta de checkpoint dentro del repo de HuggingFace.
# SUPUESTO: "vocals 238" es el mejor checkpoint disponible (238 épocas,
# loss -9.809). Si Cyru5 sube un checkpoint mejor, actualizar aquí.
_CHECKPOINT_FOLDER = "vocals 238"

# Nombre del archivo de pesos dentro de la carpeta.
_CHECKPOINT_FILE = "vocals.pth"

# Nombre del archivo de configuración JSON dentro de la carpeta.
_CONFIG_FILE = "vocals.json"

# Sample rate del modelo MedleyVox (fijo a 24 kHz según vocals.json de Cyru5).
_SAMPLE_RATE = 24_000

# Etiqueta de modelo reportada en webhooks.
_MODEL_LABEL = "medley_vox"


def separate_lead_backing(vocals_path: str) -> dict:
    """
    Inferencia PURA de MedleyVox sobre una pista vocal local.

    Carga el checkpoint Cyru5/MedleyVox@"vocals 238" (Conv-TasNet STFT, 24 kHz),
    separa la voz en dos fuentes, asigna lead/backing por energía RMS y
    transcodifica ambas a MP3. NO sube nada ni postea webhook.

    Devuelve: { "lead_mp3": <path>, "backing_mp3": <path>,
                "rms_lead": float, "rms_backing": float, "model": "medley_vox" }

    Reusado por run_medley_vox (producción) y por el smoke de S3 (validación
    local), de modo que la lógica que Samu escucha es exactamente la desplegada.
    El llamador es responsable de borrar los mp3 temporales.
    """
    import json
    import subprocess
    import tempfile
    import types

    import numpy as np
    import pyloudnorm as pyln
    import soundfile as sf
    import torch
    from asteroid_filterbanks import make_enc_dec
    from asteroid.masknn import TDConvNet
    from asteroid.models.base_models import BaseEncoderMaskerDecoder
    from huggingface_hub import hf_hub_download

    # ── Descargar pesos Cyru5/MedleyVox ─────────────────────────────────────
    ckpt_path = hf_hub_download(
        repo_id=_HF_REPO,
        filename=f"{_CHECKPOINT_FOLDER}/{_CHECKPOINT_FILE}",
        cache_dir="/root/.cache/huggingface",
    )
    cfg_path = hf_hub_download(
        repo_id=_HF_REPO,
        filename=f"{_CHECKPOINT_FOLDER}/{_CONFIG_FILE}",
        cache_dir="/root/.cache/huggingface",
    )

    # ── Cargar configuración del modelo ──────────────────────────────────────
    with open(cfg_path, "r") as f:
        cfg = json.load(f)
    model_args = cfg.get("args", cfg)
    args = types.SimpleNamespace(**model_args)

    architecture = getattr(args, "architecture", "conv_tasnet_stft")
    if architecture != "conv_tasnet_stft":
        raise NotImplementedError(
            f"Arquitectura MedleyVox no soportada: {architecture!r}. "
            "Solo 'conv_tasnet_stft' está implementado en este nodo."
        )

    encoder, decoder = make_enc_dec(
        "torch_stft",
        n_filters=args.nfft,
        kernel_size=args.nfft,
        stride=args.nhop,
        sample_rate=args.sample_rate,
    )
    masker = TDConvNet(
        in_chan=encoder.n_feats_out,
        n_src=args.n_src,
        out_chan=None,
        n_blocks=args.n_blocks,
        n_repeats=args.n_repeats,
        bn_chan=args.bn_chan,
        hid_chan=args.hid_chan,
        skip_chan=args.skip_chan,
        mask_act=args.mask_act,
    )
    model = BaseEncoderMaskerDecoder(encoder, masker, decoder)

    # ── Cargar pesos (EMA si disponible) ─────────────────────────────────────
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    checkpoint = torch.load(ckpt_path, map_location=device)
    ema = getattr(args, "ema", False)
    use_ema = getattr(args, "use_ema_model", True)
    if ema and use_ema:
        model_state = model.state_dict()
        ema_state = {
            k.replace("ema_model.module.", ""): v
            for k, v in checkpoint.items()
            if k.replace("ema_model.module.", "") in model_state
        }
        model_state.update(ema_state)
        model.load_state_dict(model_state)
    else:
        model.load_state_dict(checkpoint)

    model.to(device)
    model.eval()

    # ── Cargar y normalizar el audio vocal (-24 LUFS) ────────────────────────
    import librosa

    mix, _ = librosa.load(vocals_path, sr=_SAMPLE_RATE, mono=True, dtype=np.float32)
    meter = pyln.Meter(_SAMPLE_RATE)
    lufs = meter.integrated_loudness(mix)
    if not np.isinf(lufs):
        adjusted_gain = -24.0 - lufs
        mix = mix * (10 ** (adjusted_gain / 20.0))
    else:
        adjusted_gain = 0.0

    mix_tensor = torch.as_tensor(
        mix[np.newaxis, np.newaxis, :], dtype=torch.float32
    ).to(device)

    # ── Inferencia MedleyVox ─────────────────────────────────────────────────
    with torch.no_grad():
        out_wavs = model.separate(mix_tensor)

    inv_gain = 10 ** (-adjusted_gain / 20.0)
    if device.type == "cuda":
        out_wav_1 = out_wavs[0, 0, :].cpu().detach().numpy() * inv_gain
        out_wav_2 = out_wavs[0, 1, :].cpu().detach().numpy() * inv_gain
    else:
        out_wav_1 = out_wavs[0, 0, :].detach().numpy() * inv_gain
        out_wav_2 = out_wavs[0, 1, :].detach().numpy() * inv_gain

    # ── Asignar lead / backing por energía RMS ───────────────────────────────
    rms_1 = float(np.sqrt(np.mean(out_wav_1 ** 2)))
    rms_2 = float(np.sqrt(np.mean(out_wav_2 ** 2)))
    if rms_1 >= rms_2:
        lead_wav, backing_wav = out_wav_1, out_wav_2
        rms_lead, rms_backing = rms_1, rms_2
    else:
        lead_wav, backing_wav = out_wav_2, out_wav_1
        rms_lead, rms_backing = rms_2, rms_1

    # ── Guardar WAV temporal → transcodificar a MP3 ──────────────────────────
    lead_wav_tmp = tempfile.mkstemp(suffix=".wav")[1]
    backing_wav_tmp = tempfile.mkstemp(suffix=".wav")[1]
    lead_tmp = tempfile.mkstemp(suffix=".mp3")[1]
    backing_tmp = tempfile.mkstemp(suffix=".mp3")[1]
    sf.write(lead_wav_tmp, lead_wav, _SAMPLE_RATE, format="WAV")
    sf.write(backing_wav_tmp, backing_wav, _SAMPLE_RATE, format="WAV")
    for wav_in, mp3_out in ((lead_wav_tmp, lead_tmp), (backing_wav_tmp, backing_tmp)):
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_in, "-codec:a", "libmp3lame",
             "-qscale:a", "2", mp3_out],
            check=True,
            capture_output=True,
        )
    for tmp in (lead_wav_tmp, backing_wav_tmp):
        try:
            import os as _os
            _os.unlink(tmp)
        except OSError:
            pass

    return {
        "lead_mp3": lead_tmp,
        "backing_mp3": backing_tmp,
        "rms_lead": rms_lead,
        "rms_backing": rms_backing,
        "model": _MODEL_LABEL,
    }


def run_medley_vox(payload: dict) -> None:
    """
    Nodo S3: separa voz líder y coros de la pista vocal con MedleyVox.

    Flujo:
      1. Re-extrae vocal desde el audio original (get_url del payload).
      2. Carga el checkpoint Cyru5/MedleyVox@"vocals 238" via huggingface_hub.
      3. Inferencia MedleyVox → dos fuentes (out_wav_1, out_wav_2).
      4. Asigna lead/backing por energía RMS.
      5. Sube ambas pistas con upload_put.
      6. Postea webhook leadBacking.

    En excepción postea webhook failed y re-lanza (Modal registra el fallo).
    """
    import os

    # Helpers canónicos del orquestador.
    from sections._common import (
        extract_storage_key,
        extract_vocals_stem,
        post_webhook,
        upload_put,
    )

    job_id: str = payload["jobId"]
    get_url: str = payload["input"]["getUrl"]
    uploads_lb: dict = payload.get("uploads", {}).get("leadBacking", {})
    webhook: dict = payload["webhook"]

    try:
        # ── 1. Re-extraer stem vocal desde el audio original ─────────────────
        vocals_path = extract_vocals_stem(get_url)

        # ── 2. Inferencia MedleyVox (lead/backing por RMS + transcode mp3) ───
        sep = separate_lead_backing(vocals_path)

        # ── 3. Subir pistas y recopilar keys ─────────────────────────────────
        outputs: dict[str, str] = {}
        for track, tmp_path in (("lead", sep["lead_mp3"]), ("backing", sep["backing_mp3"])):
            put_url = uploads_lb.get(track)
            if not put_url:
                # SUPUESTO: si no hay PUT URL para la pista (leadBacking no habilitado
                # en el payload), se omite silenciosamente y el output queda vacío.
                continue
            upload_put(put_url, tmp_path, content_type="audio/mpeg")
            outputs[track] = extract_storage_key(put_url)

        # Limpiar mp3 temporales.
        for tmp in (sep["lead_mp3"], sep["backing_mp3"]):
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
