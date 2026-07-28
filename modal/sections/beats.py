"""Beat-tracking (librosa, best-effort) compartido entre align_app.py y
songformer.py. Detecta bpm/beats sobre la MEZCLA completa (no el stem vocal),
best-effort: cualquier excepcion o deteccion pobre devuelve None y el llamador
sigue -- el metronomo es una feature aparte, nunca debe tumbar el forced
alignment ni la deteccion de secciones.

Portado tal cual desde align_app.py (_beats_payload/_detect_beats), sin
cambiar comportamiento.
"""

# `modal deploy` importa este modulo bajo el Python local (3.9), que no soporta
# la sintaxis de union `X | None` (PEP 604, 3.10+). Diferir la evaluacion de
# anotaciones lo hace compatible.
from __future__ import annotations

_MIN_BEATS = 8


def beats_payload(raw: dict | None) -> dict | None:
    """Normaliza el resultado del beat-tracking; None si no es usable
    (best-effort: pocos beats detectados o bpm invalido)."""
    if not raw or not raw.get("beatsMs") or len(raw["beatsMs"]) < _MIN_BEATS:
        return None
    bpm = float(raw.get("bpm") or 0)
    if bpm <= 0:
        return None
    return {"bpm": round(bpm, 2), "beatsMs": [int(t) for t in raw["beatsMs"]]}


def detect_beats(audio_path: str) -> dict | None:
    """Beat-tracking con librosa sobre la MEZCLA completa (no el stem
    vocal). Best-effort: cualquier excepcion devuelve None y el llamador
    sigue -- el metronomo es una feature aparte, nunca debe tumbar el
    pipeline que lo invoca."""
    try:
        import numpy as np
        import librosa  # solo disponible dentro del contenedor Modal

        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        tempo, beat_times = librosa.beat.beat_track(y=y, sr=sr, units="time")
        bpm = float(np.atleast_1d(tempo)[0])
        return beats_payload({"bpm": bpm, "beatsMs": [int(t * 1000) for t in beat_times]})
    except Exception as exc:
        print(f"beat-tracking fallo (no fatal): {exc}")
        return None
