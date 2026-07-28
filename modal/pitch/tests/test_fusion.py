from unittest.mock import patch

from fusion import run_fusion

# Una linea con una silaba (0.0-1.0s) que NO cubre la nota huerfana (10.0-14.0s).
LINES_WORDS = [[{"text": "la", "start": 0.0, "end": 1.0}]]
NOTES_LEAD = [{"start": 10.0, "end": 14.0, "midi": 60, "cents": 0, "note": "C4"}]


def _run(notes_lead=NOTES_LEAD, lines_words=LINES_WORDS):
    with patch("fusion.request_signed_put", return_value="https://put.example/analysis.json"), \
         patch("fusion.upload_put"), \
         patch("fusion.extract_storage_key", return_value="export/analysis.json"), \
         patch("fusion.post_webhook"):
        return run_fusion(
            "job-1", webhook={}, sign_upload_url="https://sign.example",
            inbound_secret="secret", notes_lead=notes_lead, notes_backing=[], lines_words=lines_words,
        )


def test_warnings_incluye_tramos_huerfanos():
    analysis = _run()
    assert analysis["warnings"] == {"orphanSpans": [{"startMs": 10000, "endMs": 14000}]}


def test_sin_tramos_huerfanos_warnings_vacio():
    # La silaba cubre exactamente la nota: no hay huerfanos.
    analysis = _run(notes_lead=[{"start": 0.0, "end": 1.0, "midi": 60, "cents": 0, "note": "C4"}])
    assert analysis["warnings"] == {"orphanSpans": []}


def test_orphan_note_spans_que_lanza_no_tumba_la_fusion():
    with patch("fusion.orphan_note_spans", side_effect=RuntimeError("boom")):
        analysis = _run()
    assert "warnings" not in analysis
    assert analysis["voices_present"] == ["lead", "backing"]
