import math
from core import hz_to_midi, midi_to_name

def test_hz_to_midi_a4():
    assert math.isclose(hz_to_midi(440.0), 69.0, abs_tol=1e-6)
def test_hz_to_midi_silence_is_nan():
    assert math.isnan(hz_to_midi(0)) and math.isnan(hz_to_midi(-1))
def test_midi_to_name_c4(): assert midi_to_name(60) == 'C4'
def test_midi_to_name_a4(): assert midi_to_name(69) == 'A4'
def test_midi_to_name_g3(): assert midi_to_name(55) == 'G3'
