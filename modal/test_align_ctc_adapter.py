"""El adaptador convierte la salida de ctc-forced-aligner (spans por palabra)
al formato de palabras whisperx-like que ya consume align_mapping."""
from align_ctc_adapter import ctc_words_to_whisperx_segments


def test_adapter_basic():
    # ctc-forced-aligner: [{"text": "hola", "start": 1.0, "end": 1.4, "score": 0.9}, ...]
    ctc_words = [
        {"text": "hola", "start": 1.0, "end": 1.4, "score": 0.9},
        {"text": "mundo", "start": 1.5, "end": 2.0, "score": 0.8},
    ]
    segs = ctc_words_to_whisperx_segments(ctc_words)
    assert segs == [{
        "words": [
            {"word": "hola", "start": 1.0, "end": 1.4, "score": 0.9},
            {"word": "mundo", "start": 1.5, "end": 2.0, "score": 0.8},
        ]
    }]


def test_adapter_skips_empty_tokens():
    ctc_words = [{"text": "", "start": 0.0, "end": 0.1, "score": 0.0},
                 {"text": "si", "start": 0.2, "end": 0.4, "score": 0.7}]
    segs = ctc_words_to_whisperx_segments(ctc_words)
    assert len(segs[0]["words"]) == 1
