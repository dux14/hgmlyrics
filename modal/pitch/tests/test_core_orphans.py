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

def test_orphan_survives_minimal_touch_with_neighbor_syllable():
    # nota de 4s que roza 10ms con una silaba vecina: 0.01/4.0 = 0.25% << 30%,
    # sigue siendo huerfana entera (el roce NO la marca como cubierta).
    events = [{"start": 0.0, "end": 4.0, "midi": 60, "cents": 0, "note": "C4"}]
    syls = [{"text": "la", "start": -0.5, "end": 0.01}]
    assert orphan_note_spans(events, syls) == [{"startMs": 0, "endMs": 4000}]

def test_orphan_covered_by_union_of_short_syllables():
    # 3 silabas cortas no solapadas entre si, ninguna cubre el 30% sola, pero
    # la UNION (1.5s de 4.0s = 37.5%) si supera el umbral -> cubierta.
    events = [{"start": 0.0, "end": 4.0, "midi": 60, "cents": 0, "note": "C4"}]
    syls = [
        {"text": "la", "start": 0.0, "end": 0.5},
        {"text": "la", "start": 1.5, "end": 2.0},
        {"text": "la", "start": 3.0, "end": 3.5},
    ]
    assert orphan_note_spans(events, syls) == []

def test_orphan_just_below_coverage_threshold_stays_orphan():
    # cobertura 1.1s de 4.0s = 27.5% < 30% -> sigue huerfana.
    events = [{"start": 0.0, "end": 4.0, "midi": 60, "cents": 0, "note": "C4"}]
    syls = [
        {"text": "la", "start": 0.0, "end": 0.6},
        {"text": "la", "start": 1.0, "end": 1.5},
    ]
    assert orphan_note_spans(events, syls) == [{"startMs": 0, "endMs": 4000}]

def test_orphan_run_splits_on_covered_event_in_middle():
    events = [
        {"start": 0.0, "end": 3.5, "midi": 60, "cents": 0, "note": "C4"},
        {"start": 3.5, "end": 4.0, "midi": 62, "cents": 0, "note": "D4"},
        {"start": 4.0, "end": 7.5, "midi": 60, "cents": 0, "note": "C4"},
    ]
    syls = [{"text": "la", "start": 3.5, "end": 4.0}]
    assert orphan_note_spans(events, syls) == [
        {"startMs": 0, "endMs": 3500},
        {"startMs": 4000, "endMs": 7500},
    ]

def test_orphan_new_span_starts_after_real_gap():
    events = [
        {"start": 0.0, "end": 3.5, "midi": 60, "cents": 0, "note": "C4"},
        {"start": 5.0, "end": 8.5, "midi": 62, "cents": 0, "note": "D4"},
    ]
    assert orphan_note_spans(events, []) == [
        {"startMs": 0, "endMs": 3500},
        {"startMs": 5000, "endMs": 8500},
    ]
