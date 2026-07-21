# modal/pitch/separation.py
"""Nodo GPU de hkn-pitch: separacion de voces (lead/backing).

Fase 'separation' del pipeline Partitura vocal M1. Corre BS-RoFormer ep_317
sobre el audio original para extraer SOLO el stem vocal, y luego MedleyVox
para dividir ese vocal en voz lider (lead) y coros (backing). Sube ambos
stems y postea UN webhook de fase. Devuelve los bytes de lead/backing EN
MEMORIA para la fase f0 siguiente (evita volver a descargar).

Tecnica de inferencia espejada de modal/sections/extract.py (BS-RoFormer
ep_317) y modal/sections/medley_vox.py (MedleyVox lead/backing por RMS) —
codigo propio, esos modulos NO se importan (dominio distinto).
"""
from __future__ import annotations
import os

from _common import request_signed_put, upload_put, post_webhook, artifact, extract_storage_key

# Modelo de separacion vocal (igual que sections/extract.py). Swap SOTA
# jul-2026 con rollback por env var: VOCAL_MODEL_CKPT=<filename> permite
# volver a ep_317 sin redeploy de codigo.
_BS_ROFORMER_MODEL = os.environ.get(
    "VOCAL_MODEL_CKPT",
    "melband_roformer_big_beta4.ckpt",
)

# Pesos MedleyVox (igual que sections/medley_vox.py).
_HF_REPO = "Cyru5/MedleyVox"
_CHECKPOINT_FOLDER = "vocals 238"
_CHECKPOINT_FILE = "vocals.pth"
_CONFIG_FILE = "vocals.json"
_SAMPLE_RATE = 24_000


def run_separation(job_id, webhook, sign_upload_url, inbound_secret, audio_bytes):
    """
    Nodo GPU de la fase 'separation'. Recibe los bytes del audio original,
    separa el stem vocal con BS-RoFormer ep_317 (single stem "Vocals") y lo
    divide en lead/backing con MedleyVox (Conv-TasNet STFT, checkpoint
    Cyru5/MedleyVox "vocals 238", 24kHz, normalizacion LUFS -24; lead = fuente
    de mayor RMS). Sube stems/lead.wav y stems/backing.wav, postea UN webhook
    'separation' con ambos artefactos, y devuelve (lead_bytes, backing_bytes)
    para f0.py (evita re-descargar/re-separar).

    En fallo: post_webhook(..., {"ok": False, "error": str(exc)[:400]}) y
    re-lanza (run_pipeline decide la cascada).
    """
    # Imports pesados dentro de la funcion: solo existen en el contenedor Modal.
    import io
    import json
    import tempfile
    import types

    import librosa
    import numpy as np
    import pyloudnorm as pyln
    import soundfile as sf
    import torch
    from asteroid.masknn import TDConvNet
    from asteroid.models.base_models import BaseEncoderMaskerDecoder
    from asteroid_filterbanks import make_enc_dec
    from audio_separator.separator import Separator
    from huggingface_hub import hf_hub_download

    try:
        # ── 1. Escribir audio_bytes a un archivo temporal ────────────────────
        fd, src_path = tempfile.mkstemp(suffix=".audio")
        with os.fdopen(fd, "wb") as f:
            f.write(audio_bytes)

        # ── 2. BS-RoFormer ep_317: extraer SOLO el stem vocal ────────────────
        vocals_out = tempfile.mkdtemp()
        vocals_sep = Separator(
            output_dir=vocals_out,
            output_format="wav",
            output_single_stem="Vocals",
        )
        vocals_sep.load_model(model_filename=_BS_ROFORMER_MODEL)
        vocals_files = vocals_sep.separate(src_path)
        if not vocals_files:
            raise RuntimeError("ep_317 no produjo el stem vocal")
        vocals_path = vocals_files[0]
        if not os.path.isabs(vocals_path):
            vocals_path = os.path.join(vocals_out, vocals_path)

        # ── 3. MedleyVox: dividir el vocal en lead/backing ───────────────────
        # Descargar pesos Cyru5/MedleyVox (checkpoint "vocals 238").
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
        with open(cfg_path, "r") as f:
            cfg = json.load(f)
        model_args = cfg.get("args", cfg)
        args = types.SimpleNamespace(**model_args)

        architecture = getattr(args, "architecture", "conv_tasnet_stft")
        if architecture != "conv_tasnet_stft":
            raise NotImplementedError(
                f"Arquitectura MedleyVox no soportada: {architecture!r}"
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

        # Normalizar el vocal a -24 LUFS antes de separar (igual que medley_vox.py).
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

        with torch.no_grad():
            out_wavs = model.separate(mix_tensor)

        inv_gain = 10 ** (-adjusted_gain / 20.0)
        if device.type == "cuda":
            out_wav_1 = out_wavs[0, 0, :].cpu().detach().numpy() * inv_gain
            out_wav_2 = out_wavs[0, 1, :].cpu().detach().numpy() * inv_gain
        else:
            out_wav_1 = out_wavs[0, 0, :].detach().numpy() * inv_gain
            out_wav_2 = out_wavs[0, 1, :].detach().numpy() * inv_gain

        # SUPUESTO (igual que sections/medley_vox.py): mayor energia RMS ≡ voz
        # lider. Valido en la mayoria de pop/reggaeton; puede fallar en temas
        # con coros muy potentes.
        rms_1 = float(np.sqrt(np.mean(out_wav_1 ** 2)))
        rms_2 = float(np.sqrt(np.mean(out_wav_2 ** 2)))
        if rms_1 >= rms_2:
            lead_wav, backing_wav = out_wav_1, out_wav_2
        else:
            lead_wav, backing_wav = out_wav_2, out_wav_1

        # ── 4. Materializar lead/backing como WAV bytes (24kHz) ──────────────
        lead_buf = io.BytesIO()
        backing_buf = io.BytesIO()
        sf.write(lead_buf, lead_wav, _SAMPLE_RATE, format="WAV")
        sf.write(backing_buf, backing_wav, _SAMPLE_RATE, format="WAV")
        lead_bytes = lead_buf.getvalue()
        backing_bytes = backing_buf.getvalue()

        # ── 5. Subir ambos stems (key relativa; Vercel antepone el prefijo) ──
        put_lead = request_signed_put(sign_upload_url, inbound_secret, job_id, "stems/lead.wav")
        upload_put(put_lead, lead_bytes, "audio/wav")
        key_lead = extract_storage_key(put_lead)

        put_backing = request_signed_put(sign_upload_url, inbound_secret, job_id, "stems/backing.wav")
        upload_put(put_backing, backing_bytes, "audio/wav")
        key_backing = extract_storage_key(put_backing)

        # ── 6. Webhook de exito ───────────────────────────────────────────────
        post_webhook(webhook, job_id, "separation", {
            "ok": True,
            "artifacts": [
                artifact("stem_lead", key_lead, "audio/wav"),
                artifact("stem_backing", key_backing, "audio/wav"),
            ],
        })
    except Exception as exc:
        post_webhook(webhook, job_id, "separation", {"ok": False, "error": str(exc)[:400]})
        raise

    return lead_bytes, backing_bytes
