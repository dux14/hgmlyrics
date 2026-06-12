# modal/sections/songformer.py
"""
S2 — segmentacion de estructura musical con SongFormer (ASLP-lab).

Modelo: ASLP-lab/SongFormer (HuggingFace)
  https://huggingface.co/ASLP-lab/SongFormer

Que hace:
  1. Descarga el audio de entrada desde el signed GET URL del payload.
  2. Resamplea a 24 kHz mono (requisito del modelo segun el paper y model card).
  3. Corre inferencia con SongFormer → lista de segmentos con etiqueta en ingles.
  4. Normaliza las etiquetas al mapa ES definido mas abajo.
  5. Postea el webhook `structure` con `{status, model, segments}`.
  NO sube audio (S2 es solo estructura, sin pistas de audio).

CONTRATO DE SALIDA (webhook `structure`):
  {
    "jobId": "<id>",
    "section": "structure",
    "result": {
      "status": "done",
      "model": "songformer",
      "segments": [{"label": str, "start": float, "end": float}, ...]
    },
    "error": null
  }

API DE INFERENCIA (verificada en HF model card + GitHub README, jun 2026):
  SongFormer usa trust_remote_code=True y expone un modelo callable:
    songformer = AutoModel.from_pretrained(local_dir, trust_remote_code=True)
    result = songformer("path/to/audio.wav")
    # result: [{"start": float, "end": float, "label": str}, ...]  # segundos
  El output es ya una lista de dicts {start, end, label} — no requiere
  decodificacion de logits ni parseo de texto.

VERIFICACION EN DEPLOY (concernimientos a validar en primer smoke):
  - trust_remote_code=True puede importar dependencias adicionales (MuQ, MusicFM,
    SSL backbones) que no estan en requirements.txt. Si el cold start falla con
    ImportError, agregar los paquetes faltantes a requirements.txt.
  - La lista exacta de etiquetas que emite el modelo se toma del GitHub README
    (ISMIR 2024): intro, verse, chorus, bridge, inst, outro, silence, pre-chorus.
    Si el modelo emite etiquetas nuevas, apareceran sin traducir (pass-through).
  - El sample rate de 24 kHz se toma del model card. Si el modelo acepta otra
    frecuencia, actualizar _TARGET_SR.
"""

from __future__ import annotations

import os
import sys
import tempfile

# Mapa EXACTO de etiquetas ingles → espanol (segun especificacion de tarea).
# Si el modelo emite una etiqueta que no esta en el mapa, se pasa tal cual.
_LABEL_MAP: dict[str, str] = {
    "intro": "intro",
    "verse": "verso",
    "chorus": "coro",
    "bridge": "puente",
    "inst": "instrumental",         # etiqueta real del modelo (no "instrumental")
    "instrumental": "instrumental",  # por si el modelo emite la forma larga
    "outro": "outro",
    "silence": "silencio",
    "pre-chorus": "pre-coro",
    "pre_chorus": "pre-coro",        # variante con guion bajo
}

# Sample rate requerido por SongFormer segun el model card (24 kHz).
_TARGET_SR: int = 24_000

# Identificador del modelo en HuggingFace Hub.
_HF_MODEL_ID: str = "ASLP-lab/SongFormer"

# Etiqueta de modelo que se reporta en los webhooks.
_MODEL_LABEL: str = "songformer"

# Cache de la instancia del modelo (None hasta el primer uso).
# Patron identico al que usa extract.py para los modelos de demucs/BSRoFormer.
_songformer_instance = None


def _normalize_label(raw: str) -> str:
    """
    Normaliza una etiqueta del modelo al espanol segun _LABEL_MAP.
    Si la etiqueta no esta en el mapa, la devuelve sin modificar.
    """
    return _LABEL_MAP.get(raw.lower().strip(), raw)


def _resample_to_24k(src_path: str, dst_path: str) -> None:
    """
    Resamplea el audio de src_path a _TARGET_SR Hz mono y lo escribe en dst_path
    como WAV. Usa librosa (incluido via audio-separator o como dep directa).

    VERIFICACION EN DEPLOY: si librosa no esta disponible en la imagen, usar
    torchaudio.transforms.Resample que ya esta en la imagen (torch dep de demucs).
    """
    import numpy as np  # noqa: F401 — transitivo via torch/librosa

    try:
        import librosa
        import soundfile as sf

        audio, _ = librosa.load(src_path, sr=_TARGET_SR, mono=True)
        sf.write(dst_path, audio, _TARGET_SR)
    except ImportError:
        # Fallback: torchaudio (siempre disponible en la imagen porque demucs lo usa).
        import torchaudio
        import torch

        waveform, orig_sr = torchaudio.load(src_path)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if orig_sr != _TARGET_SR:
            resampler = torchaudio.transforms.Resample(
                orig_freq=orig_sr, new_freq=_TARGET_SR
            )
            waveform = resampler(waveform)
        torchaudio.save(dst_path, waveform, _TARGET_SR)


def _get_songformer():
    """
    Carga SongFormer una vez y cachea la instancia a nivel de modulo.
    Usa snapshot_download para obtener el codigo remoto del modelo y luego
    AutoModel.from_pretrained con trust_remote_code=True (requerido por el model card).

    VERIFICACION EN DEPLOY:
      - trust_remote_code descarga e importa el codigo custom del repo HF.
        Si el modelo importa MuQ / MusicFM al cargarse y esos paquetes no
        estan en la imagen, agregar a requirements.txt antes de re-desplegar.
    """
    global _songformer_instance
    if _songformer_instance is not None:
        return _songformer_instance

    from huggingface_hub import snapshot_download
    from transformers import AutoModel

    local_dir = snapshot_download(
        repo_id=_HF_MODEL_ID,
        repo_type="model",
    )
    sys.path.append(local_dir)
    os.environ["SONGFORMER_LOCAL_DIR"] = local_dir

    model = AutoModel.from_pretrained(local_dir, trust_remote_code=True)
    model.to("cuda:0").eval()

    _songformer_instance = model
    return _songformer_instance


def _run_inference(audio_path: str) -> list[dict]:
    """
    Corre SongFormer sobre el archivo de audio (24 kHz WAV/mono) y devuelve
    una lista de dicts con {label:str, start:float, end:float}.

    API real (model card ASLP-lab/SongFormer + GitHub README, jun 2026):
      songformer(wav_path) devuelve directamente una lista de dicts
      {start: float, end: float, label: str} en segundos.
      No requiere decodificacion de logits ni parseo de texto adicional.
    """
    songformer = _get_songformer()
    raw_result = songformer(audio_path)

    # Normalizar por si las claves difieren de la especificacion documentada.
    # El contrato de salida de esta funcion siempre es [{label, start, end}, ...].
    segments = []
    for seg in raw_result:
        label = seg.get("label", "")
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start))
        segments.append({"label": label, "start": start, "end": end})
    return segments


def run_songformer(payload: dict) -> None:
    """
    Nodo S2: descarga el audio de entrada, corre SongFormer para obtener
    la estructura musical, normaliza las etiquetas a espanol y postea el
    webhook de la seccion `structure`.

    En caso de excepcion posta un webhook `failed` para structure y propaga
    la excepcion (Modal lo registrara como fallo de la funcion).

    Args:
        payload: dict con claves:
          - jobId: str
          - input.getUrl: str  (signed GET URL del audio original)
          - webhook: {url, secret}
          (NO se necesitan `uploads` — S2 no sube audio)
    """
    # Import de httpx aqui para evitar import-time fuera del contenedor Modal
    # (mismo patron que extract.py y _common.py).
    import httpx  # noqa: F401 — disponible en la imagen

    from sections._common import post_webhook

    job_id: str = payload["jobId"]
    get_url: str = payload["input"]["getUrl"]
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

        # ── 2. Resamplear a 24 kHz mono (requisito de SongFormer) ────────────
        fd2, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd2)
        _resample_to_24k(src_path, wav_path)

        # ── 3. Inferencia SongFormer ─────────────────────────────────────────
        raw_segments = _run_inference(wav_path)

        # ── 4. Normalizar etiquetas a espanol ────────────────────────────────
        segments = [
            {
                "label": _normalize_label(seg["label"]),
                "start": seg["start"],
                "end": seg["end"],
            }
            for seg in raw_segments
        ]

        # ── 5. Webhook de exito ──────────────────────────────────────────────
        post_webhook(
            webhook,
            job_id,
            section="structure",
            result={
                "status": "done",
                "model": _MODEL_LABEL,
                "segments": segments,
            },
        )

    except Exception as exc:
        # Postear fallo antes de propagar para que el front no quede esperando.
        try:
            post_webhook(
                webhook,
                job_id,
                section="structure",
                result={
                    "status": "failed",
                    "model": _MODEL_LABEL,
                    "segments": [],
                },
                error=str(exc)[:400],
            )
        except Exception:
            pass  # si el webhook en si falla, no enmascarar el error original
        raise
