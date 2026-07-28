# modal/test_sections_beats.py
"""
Tests puros (sin GPU, sin modal, sin librosa) de beats_payload en
sections/beats.py. La deteccion real (detect_beats) usa librosa y NO se
unit-testea aqui (mismo criterio que test_align_beats.py, que ahora
re-exporta estos mismos simbolos desde align_app.py).

Correr con: cd modal && python3 -m pytest test_sections_beats.py -q
"""

from __future__ import annotations

from sections.beats import beats_payload


def test_payload_none_si_deteccion_vacia():
    assert beats_payload(None) is None
    assert beats_payload({"bpm": 0, "beatsMs": []}) is None
    assert beats_payload({"bpm": 92.3, "beatsMs": [1, 2, 3]}) is None  # < 8 beats
    assert beats_payload({"beatsMs": [100, 750, 1400, 2050, 2700, 3350, 4000, 4650]}) is None  # sin bpm
    assert beats_payload({"bpm": -5, "beatsMs": [100, 750, 1400, 2050, 2700, 3350, 4000, 4650]}) is None  # bpm negativo


def test_payload_valido_redondea_y_filtra():
    p = beats_payload({"bpm": 92.34567, "beatsMs": [100, 750, 1400, 2050, 2700, 3350, 4000, 4650]})
    assert p == {"bpm": 92.35, "beatsMs": [100, 750, 1400, 2050, 2700, 3350, 4000, 4650]}
