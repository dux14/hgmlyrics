# modal/test_align_beats.py
"""
Tests puros (sin GPU, sin modal, sin whisperx, sin librosa) de _beats_payload
en align_app.py. La deteccion real (_detect_beats) usa librosa y NO se
unit-testea aqui.

Correr con: cd modal && python3 -m pytest test_align_beats.py -q
"""

from __future__ import annotations

from align_app import _beats_payload


def test_payload_none_si_deteccion_vacia():
    assert _beats_payload(None) is None
    assert _beats_payload({"bpm": 0, "beatsMs": []}) is None
    assert _beats_payload({"bpm": 92.3, "beatsMs": [1, 2, 3]}) is None  # < 8 beats


def test_payload_valido_redondea_y_filtra():
    p = _beats_payload({"bpm": 92.34567, "beatsMs": [100, 750, 1400, 2050, 2700, 3350, 4000, 4650]})
    assert p == {"bpm": 92.35, "beatsMs": [100, 750, 1400, 2050, 2700, 3350, 4000, 4650]}
