import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from core import midi_to_name, detect_key, key_uses_flats, fuse_syllables_notes


def test_midi_to_name_sostenidos_por_defecto():
    assert midi_to_name(58) == "A#3"
    assert midi_to_name(60) == "C4"
    assert midi_to_name(56) == "G#3"

def test_midi_to_name_bemoles():
    assert midi_to_name(58, use_flats=True) == "Bb3"
    assert midi_to_name(56, use_flats=True) == "Ab3"
    assert midi_to_name(63, use_flats=True) == "Eb4"
    # las notas naturales no cambian
    assert midi_to_name(60, use_flats=True) == "C4"
    assert midi_to_name(62, use_flats=True) == "D4"

def test_detect_key_do_mayor_usa_sostenidos():
    # histograma con la escala de Do mayor (C D E F G A B) pesada
    h = [0.0]*12
    for pc in (0,2,4,5,7,9,11): h[pc] = 5.0
    tonic, mode = detect_key(h)
    assert (tonic, mode) == (0, "major")
    assert key_uses_flats(tonic, mode) is False

def test_detect_key_sib_mayor_usa_bemoles():
    # escala de Sib mayor: Bb C D Eb F G A -> pcs 10,0,2,3,5,7,9
    h = [0.0]*12
    for pc in (10,0,2,3,5,7,9): h[pc] = 5.0
    # reforzar la tonica para desambiguar del relativo menor (Sol menor)
    h[10] += 3.0
    tonic, mode = detect_key(h)
    assert key_uses_flats(tonic, mode) is True  # tonalidad de bemoles

def test_key_uses_flats_mapeo():
    # mayores de bemoles
    assert key_uses_flats(5, "major") is True   # Fa
    assert key_uses_flats(10, "major") is True  # Sib
    assert key_uses_flats(3, "major") is True   # Mib
    assert key_uses_flats(8, "major") is True   # Lab
    # mayores de sostenidos
    assert key_uses_flats(7, "major") is False  # Sol
    assert key_uses_flats(2, "major") is False  # Re
    assert key_uses_flats(0, "major") is False  # Do
    # menores: usar el relativo mayor (tonica+3). Re menor (2) -> Fa mayor (5) -> bemoles
    assert key_uses_flats(2, "minor") is True   # Re menor
    assert key_uses_flats(9, "minor") is False  # La menor -> Do mayor -> sostenidos

def test_fuse_respeta_use_flats():
    syls = [{"text":"lle","start":0.0,"end":0.5}]
    events = [{"start":0.0,"end":0.5,"midi":58.0,"note":"A#3","cents":0}]
    fuse_syllables_notes(syls, events, use_flats=True)
    assert syls[0]["note"] == "Bb3"
