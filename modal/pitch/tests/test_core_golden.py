import json, os
import numpy as np
from core import note_events_from_f0, fuse_syllables_notes, detect_modulations

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "golden_analysis.json")


def build_voice_analysis(times, f0, conf, lines_words):
    """Espeja lo que fusion.py hace por voz: segmentar F0, fusionar con las
    sílabas de cada línea, detectar modulaciones sobre los eventos de nota."""
    events = note_events_from_f0(times, f0, conf)
    lines = []
    for words in lines_words:
        syls = [dict(w) for w in words]
        fuse_syllables_notes(syls, events)
        lines.append({"syllables": syls})
    return {"lines": lines, "modulations": detect_modulations(events)}


def _synthetic_clip():
    # Clip de 6s: C4 durante 4s -> G4 durante 2s. El cambio en t=4.0 cae en el
    # borde de la ventana de detect_modulations (window_sec=4.0), de modo que
    # los dos eventos caen en ventanas distintas (idx 0 y 1) y se detecta 1
    # modulacion C4->G4 (+7). Las silabas de cada linea solapan su nota.
    sr = 100
    times = np.arange(0, 6.0, 1 / sr)
    f0 = np.where(times < 4.0, 261.63, 392.0)  # C4 -> G4 en t=4.0
    conf = np.full_like(times, 0.9)
    lines_words = [
        [{"text": "Me", "start": 0.0, "end": 0.5}, {"text": "vo", "start": 0.5, "end": 1.0},
         {"text": "y", "start": 1.0, "end": 1.5}],
        [{"text": "yo", "start": 4.2, "end": 4.7}, {"text": "ya", "start": 4.7, "end": 5.2}],
    ]
    return times, f0, conf, lines_words


def test_golden_analysis_json():
    analysis = build_voice_analysis(*_synthetic_clip())
    with open(FIXTURE) as f:
        expected = json.load(f)
    assert analysis == expected
