"""Deriva rangos [startMs,endMs] por seccion desde song_line_timings + el
indice de linea->seccion del snapshot aprobado."""
from clips_app import section_ranges


def test_section_ranges_basico():
    lines = [{"i": 0, "startMs": 1000}, {"i": 1, "startMs": 5000}, {"i": 2, "startMs": 9000}]
    line_sections = [0, 0, 1]
    total_ms = 12000
    ranges = section_ranges(lines, line_sections, total_ms)
    assert ranges == [
        {"sectionIndex": 0, "startMs": 1000, "endMs": 9000},
        {"sectionIndex": 1, "startMs": 9000, "endMs": 12000},
    ]


def test_section_ranges_vacio():
    assert section_ranges([], [], 0) == []
    assert section_ranges([{"i": 0, "startMs": 0}], [], 5000) == []
