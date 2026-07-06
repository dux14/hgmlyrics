import numpy as np
from core import note_events_from_f0

def test_single_sustained_note():
    times, f0, conf = np.linspace(0, 1, 100), np.full(100, 261.63), np.full(100, 0.9)
    events = note_events_from_f0(times, f0, conf)
    assert len(events) == 1 and events[0]["note"] == "C4"

def test_two_notes_with_gap():
    f0 = np.concatenate([np.full(50, 261.63), np.zeros(20), np.full(80, 392.0)])
    times, conf = np.linspace(0, 1.5, 150), np.full(150, 0.9)
    assert [e["note"] for e in note_events_from_f0(times, f0, conf)] == ["C4", "G4"]

def test_low_confidence_is_gap():
    times, f0, conf = np.linspace(0, 1, 100), np.full(100, 261.63), np.full(100, 0.1)
    assert note_events_from_f0(times, f0, conf) == []

def test_single_frame_jitter_is_merged():
    times, f0, conf = np.linspace(0, 1, 100), np.full(100, 261.63), np.full(100, 0.9)
    f0[50] = 293.66  # blip de 1 frame (D4)
    assert len(note_events_from_f0(times, f0, conf)) == 1
