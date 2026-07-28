import sys
import types
from unittest.mock import MagicMock

import pytest

import lyrics


class FakeAudio:
    """Stand-in de lo que devuelve whisperx.load_audio: solo necesitamos
    __len__ (lyrics.py lo usa para derivar audio_duration a AUDIO_SAMPLE_RATE)."""

    def __init__(self, seconds: float):
        self._n = int(seconds * lyrics.AUDIO_SAMPLE_RATE)

    def __len__(self):
        return self._n


@pytest.fixture
def fake_deps(monkeypatch):
    """Inyecta stubs de torch/whisperx/pyphen (sin GPU, sin red real) para poder
    llamar run_lyrics() en CI, y neutraliza la subida/webhook de _common.
    `pyphen.inserted` no parte de verdad en silabas: devuelve el texto tal
    cual, asi cada token de prueba es una sola "silaba" y los asserts de
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
    whisperx_mod.load_audio = MagicMock(return_value=FakeAudio(10.0))
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


def _segments(*word_lists):
    return {"segments": [{"words": list(words)} for words in word_lists]}


# --- C1: un align por linea, ninguna linea puede recibir palabras de otra --

def test_align_se_llama_una_vez_por_linea_no_una_sola_vez_global(fake_deps):
    whisperx_mod, _ = fake_deps
    lines = [
        {"text": "Hola. Que tal", "startMs": 0, "endMs": 2000},
        {"text": "Chau", "startMs": 2000, "endMs": 3000},
    ]

    def align_side_effect(segment, model, meta, audio, device):
        text = segment[0]["text"]
        if text == "Hola. Que tal":
            # simula el split por oracion interno de whisperx: 2 subsegmentos
            # para UNA sola linea de entrada.
            return _segments([_word("hola", 0.0, 0.5, 0.9)],
                              [_word("que", 0.6, 1.0, 0.8), _word("tal", 1.0, 1.5, 0.85)])
        if text == "Chau":
            return _segments([_word("chau", 2.0, 3.0, 0.7)])
        raise AssertionError(f"align llamado con texto inesperado: {text!r}")

    whisperx_mod.align.side_effect = align_side_effect

    result = _run(lines=lines, language="es")

    assert whisperx_mod.align.call_count == len(lines)  # nunca una sola llamada global
    assert [syl["text"] for syl in result[0]] == ["Hola.", "Que", "tal"]
    assert [syl["text"] for syl in result[1]] == ["Chau"]  # no se corrio con la linea anterior


# --- C2: el texto de cada silaba sale del texto aprobado, no del align ----

def test_texto_de_silabas_es_el_aprobado_con_mayusculas_y_puntuacion(fake_deps):
    whisperx_mod, _ = fake_deps
    lines = [{"text": "Primero el cielo,", "startMs": 0, "endMs": 2000}]
    # whisperx.align devuelve las words limpias: minuscula, sin coma
    # (alignment.py clean_char / word_text).
    whisperx_mod.align.return_value = _segments(
        [_word("primero", 0.0, 0.5, 0.9), _word("el", 0.5, 0.7, 0.9), _word("cielo", 0.7, 1.5, 0.85)]
    )

    result = _run(lines=lines, language="es")

    assert [syl["text"] for syl in result[0]] == ["Primero", "el", "cielo,"]


def test_word_sin_timestamp_se_interpola_y_no_se_descarta(fake_deps):
    whisperx_mod, _ = fake_deps
    lines = [{"text": "a b c", "startMs": 0, "endMs": 3000}]
    whisperx_mod.align.return_value = _segments(
        [_word("a", 0.0, 1.0, 0.9), _word("b"), _word("c", 2.0, 3.0, 0.8)]
    )

    result = _run(lines=lines, language="es")
    line = result[0]

    assert [syl["text"] for syl in line] == ["a", "b", "c"]
    b_syl = line[1]
    assert 1.0 <= b_syl["start"] < b_syl["end"] <= 2.0
    assert "score" not in b_syl  # interpolada: no viene del align, no tiene score real
    assert line[0]["score"] == 0.9 and line[2]["score"] == 0.8


def test_align_dropea_un_token_igual_no_se_descarta_ni_se_corre(fake_deps):
    """align puede omitir por completo un token que no esta en su
    diccionario (no solo devolverlo sin timestamp): la linea sigue teniendo
    todos los tokens aprobados, y el resto no se desplaza."""
    whisperx_mod, _ = fake_deps
    lines = [{"text": "uno xyz dos", "startMs": 0, "endMs": 3000}]
    # "xyz" nunca aparece en las words que devuelve el align.
    whisperx_mod.align.return_value = _segments(
        [_word("uno", 0.0, 1.0, 0.9), _word("dos", 2.0, 3.0, 0.8)]
    )

    result = _run(lines=lines, language="es")
    line = result[0]

    assert [syl["text"] for syl in line] == ["uno", "xyz", "dos"]
    assert line[0]["score"] == 0.9
    assert line[2]["score"] == 0.8
    assert "score" not in line[1]
    assert 1.0 <= line[1]["start"] < line[1]["end"] <= 2.0


def test_texto_con_nbsp_y_tab_no_estanca_el_emparejador(fake_deps):
    """text.split() (nuestro lado) parte por CUALQUIER whitespace -- tab, NBSP
    (U+00A0) pegado desde un documento -- mientras que whisperx solo corta
    por " ". Sin normalizar el separador antes de mandarlo al align, esto
    producia un token de mas de nuestro lado y estancaba toda la linea."""
    whisperx_mod, _ = fake_deps
    text = "hola mundo\tcruel"  # NBSP entre "hola" y "mundo", tab antes de "cruel"
    lines = [{"text": text, "startMs": 0, "endMs": 3000}]

    def align_side_effect(segment, model, meta, audio, device):
        # el texto que le mandamos al align debe estar normalizado a " ",
        # exactamente los tokens que separamos de nuestro lado.
        assert segment[0]["text"] == "hola mundo cruel"
        return _segments([_word("hola", 0.0, 1.0, 0.9), _word("mundo", 1.0, 2.0, 0.8),
                           _word("cruel", 2.0, 3.0, 0.7)])

    whisperx_mod.align.side_effect = align_side_effect

    result = _run(lines=lines, language="es")
    line = result[0]

    assert [syl["text"] for syl in line] == ["hola", "mundo", "cruel"]
    assert line[0]["score"] == 0.9 and line[1]["score"] == 0.8 and line[2]["score"] == 0.7


def test_word_espuria_en_el_align_no_estanca_los_tokens_posteriores(fake_deps):
    """Si la salida del align trae una word que no corresponde a ningun
    token (align dividio distinto de `tokens`), un match ciego contra
    words[wi] estancaria el resto de la linea entera en interpolacion. El
    emparejador debe saltarla y seguir alineando los tokens siguientes."""
    whisperx_mod, _ = fake_deps
    lines = [{"text": "uno dos tres", "startMs": 0, "endMs": 3000}]
    # "ruido" no corresponde a ningun token aprobado -- se intercala entre
    # "uno" y "dos".
    whisperx_mod.align.return_value = _segments([
        _word("uno", 0.0, 0.5, 0.9), _word("ruido", 0.5, 0.6, 0.5),
        _word("dos", 1.0, 2.0, 0.8), _word("tres", 2.0, 3.0, 0.7),
    ])

    result = _run(lines=lines, language="es")
    line = result[0]

    assert [syl["text"] for syl in line] == ["uno", "dos", "tres"]
    assert line[0]["score"] == 0.9
    assert line[1]["score"] == 0.8  # "dos" no se estanca por la word espuria
    assert line[2]["score"] == 0.7  # "tres" tampoco


def test_linea_entera_sin_timestamps_se_reparte_uniforme_en_las_cotas(fake_deps):
    whisperx_mod, _ = fake_deps
    lines = [{"text": "x y", "startMs": 1000, "endMs": 3000}]
    whisperx_mod.align.return_value = _segments([_word("x"), _word("y")])

    result = _run(lines=lines, language="es")
    line = result[0]

    assert line[0]["start"] == pytest.approx(1.0)
    assert line[0]["end"] == line[1]["start"]
    assert line[1]["end"] == pytest.approx(3.0)
    assert "score" not in line[0]


# --- I1: ultima linea (endMs == startMs) se acota contra la duracion real -

def test_ultima_linea_endms_igual_startms_se_acota_contra_duracion_audio(fake_deps):
    whisperx_mod, _ = fake_deps
    whisperx_mod.load_audio.return_value = FakeAudio(5.0)  # audio de 5s
    lines = [{"text": "final", "startMs": 4000, "endMs": 4000}]

    def align_side_effect(segment, model, meta, audio, device):
        assert segment[0]["end"] == pytest.approx(5.0)  # acotado a la duracion real, no 4.0==4.0
        return _segments([_word("final", 4.0, 4.8, 0.9)])

    whisperx_mod.align.side_effect = align_side_effect

    result = _run(lines=lines, language="es")

    assert len(result) == 1
    assert len(result[0]) == 1  # no queda vacia


# --- I2: lines=[] es "hay letra, cero renglones", no "sin letra" ----------

def test_lines_vacia_no_cae_al_camino_de_transcripcion(fake_deps):
    whisperx_mod, _ = fake_deps

    result = _run(lines=[], language="es")

    assert result == []
    whisperx_mod.load_model.assert_not_called()


# --- I3: language invalido se clampea, no revienta ni cae en silencio -----

def test_language_invalido_se_clampea_a_es(fake_deps):
    whisperx_mod, captured = fake_deps
    lines = [{"text": "hola", "startMs": 0, "endMs": 1000}]
    whisperx_mod.align.return_value = _segments([_word("hola", 0.0, 1.0, 0.9)])

    _run(lines=lines, language="fr")

    assert captured["align_model_language"] == "es"
    assert captured["pyphen_lang"] == "es_ES"


def test_language_ausente_default_es(fake_deps):
    whisperx_mod, captured = fake_deps
    lines = [{"text": "hola", "startMs": 0, "endMs": 1000}]
    whisperx_mod.align.return_value = _segments([_word("hola", 0.0, 1.0, 0.9)])

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
    whisperx_mod.align.return_value = _segments([
        _word("hola", 0.0, 0.5), _word("que", 0.5, 1.0), _word("tal", 2.0, 2.5),
    ])

    result = _run(lines=None, language=None)

    assert len(result) == 2
    assert [syl["text"] for syl in result[0]] == ["hola", "que"]
    assert [syl["text"] for syl in result[1]] == ["tal"]
    # camino viejo: sin "score" en la salida (whisperx.align no aporta score aqui)
    assert "score" not in result[0][0]
    fake_model.transcribe.assert_called()
    whisperx_mod.load_align_model.assert_called()
