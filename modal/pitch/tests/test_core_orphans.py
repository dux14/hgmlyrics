from core import orphan_note_spans

def test_orphan_empty_without_note_events():
    syls = [{"text": "la", "start": 0.0, "end": 1.0}]
    assert orphan_note_spans([], syls) == []

def test_orphan_span_shorter_than_min_s_discarded():
    events = [{"start": 0.0, "end": 2.0, "midi": 60, "cents": 0, "note": "C4"}]
    assert orphan_note_spans(events, []) == []

def test_orphan_span_covered_by_syllable_discarded():
    events = [{"start": 0.0, "end": 5.0, "midi": 60, "cents": 0, "note": "C4"}]
    syls = [{"text": "laaa", "start": 0.0, "end": 5.0}]
    assert orphan_note_spans(events, syls) == []

def test_orphan_real_span_detected_with_ms_bounds():
    events = [{"start": 10.0, "end": 14.0, "midi": 60, "cents": 0, "note": "C4"}]
    assert orphan_note_spans(events, []) == [{"startMs": 10000, "endMs": 14000}]

def test_orphan_overlapping_notes_do_not_duplicate_span():
    events = [
        {"start": 0.0, "end": 2.0, "midi": 60, "cents": 0, "note": "C4"},
        {"start": 1.0, "end": 4.0, "midi": 62, "cents": 0, "note": "D4"},
    ]
    assert orphan_note_spans(events, []) == [{"startMs": 0, "endMs": 4000}]
