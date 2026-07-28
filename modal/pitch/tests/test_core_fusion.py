from core import fuse_syllables_notes, detect_modulations

def test_fuse_assigns_note_by_overlap():
    syl = [{"text": "Me", "start": 0.0, "end": 0.4}]
    ev = [{"start": 0.0, "end": 0.5, "midi": 60, "cents": 0, "note": "C4"}]
    out = fuse_syllables_notes(syl, ev)
    assert out[0]["note"] == "C4" and out[0]["blank"] is False and out[0]["ditto"] is False

def test_fuse_marks_ditto_on_same_midi():
    syl = [{"text": "Me", "start": 0.0, "end": 0.4}, {"text": "he", "start": 0.4, "end": 0.8}]
    ev = [{"start": 0.0, "end": 0.8, "midi": 60, "cents": 0, "note": "C4"}]
    out = fuse_syllables_notes(syl, ev)
    assert out[1]["ditto"] is True and out[1]["note"] is None and out[1]["midi"] == 60

def test_fuse_blank_when_no_confident_overlap():
    out = fuse_syllables_notes([{"text": "...", "start": 5.0, "end": 5.2}], [])
    assert out[0]["blank"] is True and out[0]["note"] is None

def test_detect_modulations_flags_shift():
    ev = [{"start": t, "end": t + 1, "midi": 60} for t in range(4)]
    ev += [{"start": t, "end": t + 1, "midi": 67} for t in range(4, 8)]
    mods = detect_modulations(ev, window_sec=4)
    assert len(mods) == 1 and mods[0] == {"time": 4, "from": "C4", "to": "G4", "semitones": 7}

def test_detect_modulations_none_if_stable():
    ev = [{"start": t, "end": t + 1, "midi": 60} for t in range(8)]
    assert detect_modulations(ev, window_sec=4) == []
