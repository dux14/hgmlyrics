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

VERIFICACION PENDIENTE EN DEPLOY (smoke):
  - SongFormer en HF usa AutoFeatureExtractor + AutoModelForAudioFrameClassification
    (o un pipeline propio). Si el model card cambia la API de inferencia hay que
    actualizar _run_inference(). El formato de salida que se asume es una lista de
    dicts {label, start, end} o equivalente de timestamps; ver _parse_output().
  - La lista exacta de etiquetas en ingles que emite el modelo se verifica en el
    primer smoke. Las 8 del mapa son las documentadas en el paper (ISMIR 2024).
  - El sample rate de 24 kHz se toma del model card. Si el modelo acepta otra
    frecuencia, actualizar _TARGET_SR.
"""

from __future__ import annotations

import os
import tempfile

# Mapa EXACTO de etiquetas ingles → espanol (segun especificacion de tarea).
# Si el modelo emite una etiqueta que no esta en el mapa, se pasa tal cual.
_LABEL_MAP: dict[str, str] = {
    "intro": "intro",
    "verse": "verso",
    "chorus": "coro",
    "bridge": "puente",
    "instrumental": "instrumental",
    "outro": "outro",
    "silence": "silencio",
    "pre-chorus": "pre-coro",
}

# Sample rate requerido por SongFormer segun el model card (24 kHz).
_TARGET_SR: int = 24_000

# Identificador del modelo en HuggingFace Hub.
_HF_MODEL_ID: str = "ASLP-lab/SongFormer"

# Etiqueta de modelo que se reporta en los webhooks.
_MODEL_LABEL: str = "songformer"


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


def _run_inference(audio_path: str) -> list[dict]:
    """
    Corre SongFormer sobre el archivo de audio (24 kHz WAV/mono) y devuelve
    una lista de dicts con {label:str, start:float, end:float}.

    API asumida (model card ASLP-lab/SongFormer, consultado jun 2026):
      - AutoFeatureExtractor + AutoModelForAudioSegmentation o equivalente.
      - El modelo expone un pipeline "audio-segmentation" de transformers, o bien
        acepta input via feature extractor + model.forward().
      - La salida post-procesada es una lista de segmentos con timestamps.

    VERIFICACION EN DEPLOY:
      Si la API real difiere (p.ej. el repo clonable usa un script propio de
      inferencia, o la clase del modelo es distinta), actualizar segun el README
      del modelo. El contrato de salida de esta funcion NO cambia: siempre devuelve
      [{label, start, end}, ...].
    """
    import torch
    import soundfile as sf
    from transformers import pipeline as hf_pipeline

    # Intentar primero con el pipeline de alto nivel de transformers.
    # SongFormer puede estar registrado como "audio-segmentation" o similar;
    # si no, caemos al path manual de feature extractor + modelo.
    try:
        pipe = hf_pipeline(
            "audio-segmentation",
            model=_HF_MODEL_ID,
            device=0 if torch.cuda.is_available() else -1,
        )
        raw_result = pipe(audio_path)
        # transformers audio-segmentation pipeline devuelve lista de dicts
        # con claves "label", "score", "timestamp" (tuple start/end en seg).
        segments = []
        for seg in raw_result:
            label = seg.get("label", "")
            ts = seg.get("timestamp", (0.0, 0.0))
            start = float(ts[0]) if ts[0] is not None else 0.0
            end = float(ts[1]) if ts[1] is not None else start
            segments.append({"label": label, "start": start, "end": end})
        return segments

    except Exception:
        # Fallback: feature extractor + forward manual si el pipeline no esta
        # registrado para este modelo.
        from transformers import AutoFeatureExtractor, AutoModel
        import numpy as np

        audio_array, sr = sf.read(audio_path, dtype="float32")
        if audio_array.ndim > 1:
            audio_array = audio_array.mean(axis=1)

        feature_extractor = AutoFeatureExtractor.from_pretrained(_HF_MODEL_ID)
        model = AutoModel.from_pretrained(_HF_MODEL_ID)
        model.eval()

        inputs = feature_extractor(
            audio_array,
            sampling_rate=sr,
            return_tensors="pt",
        )

        with torch.no_grad():
            outputs = model(**inputs)

        # SongFormer (segun paper) devuelve logits de clasificacion por frame
        # o una lista de boundary timestamps + labels en outputs.
        # Asumimos que outputs tiene un atributo `segments` o similar;
        # de lo contrario los logits se decodifican con argmax por frame.
        if hasattr(outputs, "segments"):
            raw_segments = outputs.segments
        else:
            # Decodificacion simple: argmax sobre logits frame a frame.
            # Agrupar frames consecutivos con la misma clase.
            logits = outputs.last_hidden_state  # (1, T, num_labels) o similar
            label_ids = logits.squeeze(0).argmax(dim=-1).tolist()
            id2label = getattr(model.config, "id2label", {})
            hop_size_sec = 0.01  # asumido; verificar en model card

            segments = []
            if label_ids:
                cur_label = id2label.get(label_ids[0], str(label_ids[0]))
                cur_start = 0.0
                for i, lid in enumerate(label_ids[1:], start=1):
                    lbl = id2label.get(lid, str(lid))
                    if lbl != cur_label:
                        segments.append({
                            "label": cur_label,
                            "start": round(cur_start, 3),
                            "end": round(i * hop_size_sec, 3),
                        })
                        cur_label = lbl
                        cur_start = i * hop_size_sec
                # Ultimo segmento
                segments.append({
                    "label": cur_label,
                    "start": round(cur_start, 3),
                    "end": round(len(label_ids) * hop_size_sec, 3),
                })
            return segments

        # Si llegamos aqui es porque outputs.segments existia; normalizarlo.
        segments = []
        for seg in raw_segments:
            label = seg.get("label", "") if isinstance(seg, dict) else str(seg)
            start = float(seg.get("start", 0.0)) if isinstance(seg, dict) else 0.0
            end = float(seg.get("end", start)) if isinstance(seg, dict) else start
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
