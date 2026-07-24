import sys
import types
from unittest.mock import MagicMock

import pytest

import lyrics


@pytest.fixture
def fake_deps(monkeypatch):
    """Inyecta stubs de torch/whisperx/pyphen (sin GPU, sin red real) para poder
    llamar run_lyrics() en CI, y neutraliza la subida/webhook de _common.
    `pyphen.inserted` no parte de verdad en silabas: devuelve el texto tal
    cual, asi cada palabra de prueba es una sola "silaba" y los asserts de
    texto/orden quedan simples."""
    captured: dict = {}

    class FakePyphen:
        def __init__(self, lang=None):
            captured["pyphen_lang"] = lang

        def inserted(self, text):
            return text

    torch_mod = types.ModuleType("torch")
    torch_mod.cuda = types.SimpleNamespace(is_available=lambda: False)

    pyphen_mod = types.ModuleType("pyphen")
    pyphen_mod.Pyphen = FakePyphen

    whisperx_mod = types.ModuleType("whisperx")
    whisperx_mod.load_audio = MagicMock(return_value="AUDIO")
    whisperx_mod.load_align_model = MagicMock(
        side_effect=lambda language_code=None, device=None: (
            captured.__setitem__("align_model_language", language_code),
            ("ALIGN_MODEL", "META"),
        )[1]
    )
    whisperx_mod.align = MagicMock(return_value={"segments": []})
    whisperx_mod.load_model = MagicMock()

    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    monkeypatch.setitem(sys.modules, "pyphen", pyphen_mod)
    monkeypatch.setitem(sys.modules, "whisperx", whisperx_mod)

    monkeypatch.setattr(lyrics, "request_signed_put", lambda *a, **k: "https://x/sign")
    monkeypatch.setattr(lyrics, "upload_put", lambda *a, **k: None)
    monkeypatch.setattr(lyrics, "extract_storage_key", lambda url: "job/lyrics/words.json")
    monkeypatch.setattr(lyrics, "post_webhook", lambda *a, **k: None)

    return whisperx_mod, captured


def _run(lines=None, language=None):
    return lyrics.run_lyrics("job1", None, "https://sign", "secret", b"WAVDATA",
                              lines=lines, language=language)


def _word(text, start=None, end=None, score=None):
    w = {"word": text}
    if start is not None:
        w["start"] = start
    if end is not None:
        w["end"] = end
    if score is not None:
        w["score"] = score
    return w


# --- modo letra dada (lines) ---------------------------------------------

def test_lines_words_len_matches_lines(fake_deps):
    whisperx_mod, _ = fake_deps
    lines = [
        {"text": "hola mundo", "startMs": 0, "endMs": 1000},
        {"text": "chau", "startMs": 1000, "endMs": 2000},
    ]
    whisperx_mod.align.return_value = {"segments": [
        {"words": [_word("hola", 0.0, 0.4, 0.9), _word("mundo", 0.4, 1.0, 0.85)]},
        {"words": [_word("chau", 1.0, 2.0, 0.7)]},
    ]}

    result = _run(lines=lines, language="es")

    assert len(result) == len(lines)


def test_lines_words_text_matches_approved_line(fake_deps):
    whisperx_mod, _ = fake_deps
    lines = [
        {"text": "hola mundo", "startMs": 0, "endMs": 1000},
        {"text": "chau", "startMs": 1000, "endMs": 2000},
    ]
    whisperx_mod.align.return_value = {"segments": [
        {"words": [_word("hola", 0.0, 0.4, 0.9), _word("mundo", 0.4, 1.0, 0.85)]},
        {"words": [_word("chau", 1.0, 2.0, 0.7)]},
    ]}

    result = _run(lines=lines, language="es")

    assert [syl["text"] for syl in result[0]] == ["hola", "mundo"]
    assert [syl["text"] for syl in result[1]] == ["chau"]
    assert result[0][0]["score"] == 0.9


def test_word_sin_timestamp_se_interpola_y_no_se_descarta(fake_deps):
    whisperx_mod, _ = fake_deps
    lines = [{"text": "a b c", "startMs": 0, "endMs": 3000}]
    whisperx_mod.align.return_value = {"segments": [
        {"words": [_word("a", 0.0, 1.0, 0.9), _word("b"), _word("c", 2.0, 3.0, 0.8)]},
    ]}

    result = _run(lines=lines, language="es")
    line = result[0]

    assert [syl["text"] for syl in line] == ["a", "b", "c"]
    b_syl = line[1]
    assert 1.0 <= b_syl["start"] < b_syl["end"] <= 2.0
    assert "score" not in b_syl  # interpolada: no viene del align, no tiene score real
    assert line[0]["score"] == 0.9 and line[2]["score"] == 0.8


def test_linea_entera_sin_timestamps_se_reparte_uniforme_en_las_cotas(fake_deps):
    whisperx_mod, _ = fake_deps
    lines = [{"text": "x y", "startMs": 1000, "endMs": 3000}]
    whisperx_mod.align.return_value = {"segments": [
        {"words": [_word("x"), _word("y")]},
    ]}

    result = _run(lines=lines, language="es")
    line = result[0]

    assert line[0]["start"] == pytest.approx(1.0)
    assert line[0]["end"] == line[1]["start"]
    assert line[1]["end"] == pytest.approx(3.0)
    assert "score" not in line[0]


def test_language_ausente_default_es(fake_deps):
    whisperx_mod, captured = fake_deps
    lines = [{"text": "hola", "startMs": 0, "endMs": 1000}]
    whisperx_mod.align.return_value = {"segments": [
        {"words": [_word("hola", 0.0, 1.0, 0.9)]},
    ]}

    _run(lines=lines, language=None)

    assert captured["align_model_language"] == "es"
    assert captured["pyphen_lang"] == "es_ES"
    whisperx_mod.load_model.assert_not_called()  # sin lines no se transcribe


# --- modo historico (sin lines) -------------------------------------------

def test_sin_lines_camino_viejo_intacto(fake_deps):
    whisperx_mod, captured = fake_deps
    fake_model = MagicMock()
    fake_model.transcribe.return_value = {
        "language": "es",
        "segments": [{"words": [
            _word("hola", 0.0, 0.5),
            _word("que", 0.5, 1.0),
            _word("tal", 2.0, 2.5),  # gap 1.0s > PAUSE_THRESHOLD_S: nueva linea
        ]}],
    }
    whisperx_mod.load_model.return_value = fake_model
    whisperx_mod.align.return_value = {"segments": [{"words": [
        _word("hola", 0.0, 0.5),
        _word("que", 0.5, 1.0),
        _word("tal", 2.0, 2.5),
    ]}]}

    result = _run(lines=None, language=None)

    assert len(result) == 2
    assert [syl["text"] for syl in result[0]] == ["hola", "que"]
    assert [syl["text"] for syl in result[1]] == ["tal"]
    # camino viejo: sin "score" en la salida (whisperx.align no aporta score aqui)
    assert "score" not in result[0][0]
    fake_model.transcribe.assert_called()
    whisperx_mod.load_align_model.assert_called()
