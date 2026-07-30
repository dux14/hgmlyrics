# modal/test_align_mapping.py
"""
Tests puros (sin GPU, sin modal, sin whisperx) de align_mapping.py.

Correr con: cd modal && python3 -m pytest test_align_mapping.py -q
"""

from __future__ import annotations

from align_mapping import map_words_to_lines, normalize


# ──────────────────────────────────────────────────────────────────────────────
# normalize() — notacion silabica del wiki (letra real de "Santo")
# ──────────────────────────────────────────────────────────────────────────────

def test_normalize_notacion_silabica_con_guiones():
    assert normalize("Sa - a - a - an - to") == ["sa", "a", "a", "an", "to"]


def test_normalize_colapsa_alargamiento_vocalico():
    assert normalize("Ho sa naen el cieee lo,") == ["ho", "sa", "naen", "el", "cie", "lo"]


def test_normalize_colapsa_alargamiento_con_puntuacion_final():
    assert normalize("Dioos del u ni ver sooo,") == ["dios", "del", "u", "ni", "ver", "so"]


def test_normalize_minusculas_y_tildes():
    assert normalize("Corazón Único") == ["corazon", "unico"]


def test_normalize_preserva_la_ene():
    assert normalize("ñooor") == ["ñor"]


def test_normalize_ano_y_anio_no_colisionan():
    assert normalize("año") != normalize("ano")


# ──────────────────────────────────────────────────────────────────────────────
# map_words_to_lines()
# ──────────────────────────────────────────────────────────────────────────────

def test_tokens_silabicos_anclan_palabra_completa_de_whisperx():
    """'santo' (WhisperX) debe anclar la linea silabica 'Sa - a - an - to'."""
    lines = [{"i": 0, "text": "Sa - a - an - to"}]
    words = [{"word": "Santo", "start": 1.2}]

    result = map_words_to_lines(lines, words)

    assert result == [
        {
            "i": 0,
            "startMs": 1200,
            "endMs": None,
            "score": None,
            "interpolated": False,
            "words": [{"word": "Santo", "startMs": 1200, "endMs": None, "score": None}],
        }
    ]


def test_words_y_endms_se_conservan_desde_whisperx():
    """endMs/words son nuevos (Task 9): endMs = 'end' (ms) de la ULTIMA
    palabra asignada a la linea; words junta todas las palabras ancladas."""
    lines = [{"i": 0, "text": "gracias por venir"}]
    words = [
        {"word": "gracias", "start": 1.0, "end": 1.4, "score": 0.9},
        {"word": "por", "start": 1.4, "end": 1.5, "score": 0.8},
        {"word": "venir", "start": 1.5, "end": 1.9, "score": 0.95},
    ]

    result = map_words_to_lines(lines, words)

    assert result[0]["endMs"] == 1900
    assert result[0]["words"] == [
        {"word": "gracias", "startMs": 1000, "endMs": 1400, "score": 0.9},
        {"word": "por", "startMs": 1400, "endMs": 1500, "score": 0.8},
        {"word": "venir", "startMs": 1500, "endMs": 1900, "score": 0.95},
    ]


def test_linea_sin_palabras_ancladas_no_inventa_tiempos():
    lines = [
        {"i": 0, "text": "hola"},
        {"i": 1, "text": "linea fantasma que no dice el audio"},
    ]
    words = [{"word": "hola", "start": 1.0, "end": 1.3}]

    result = map_words_to_lines(lines, words)

    assert result[1]["words"] == []
    assert result[1]["endMs"] is None


def test_ancla_directa_con_score_propaga_el_score_de_whisperx():
    lines = [{"i": 0, "text": "Sa - a - an - to"}]
    words = [{"word": "Santo", "start": 1.2, "score": 0.9}]

    result = map_words_to_lines(lines, words)

    assert result[0]["score"] == 0.9
    assert result[0]["interpolated"] is False


def test_ancla_directa_sin_score_emite_score_none():
    lines = [{"i": 0, "text": "Sa - a - an - to"}]
    words = [{"word": "Santo", "start": 1.2}]

    result = map_words_to_lines(lines, words)

    assert result[0]["score"] is None
    assert result[0]["interpolated"] is False


def test_linea_sin_ancla_interpola_entre_vecinas():
    lines = [
        {"i": 0, "text": "hola"},
        {"i": 1, "text": "linea fantasma que no dice el audio"},
        {"i": 2, "text": "mundo"},
    ]
    words = [
        {"word": "hola", "start": 1.0},
        {"word": "mundo", "start": 3.0},
    ]

    result = map_words_to_lines(lines, words)

    assert result[0] == {
        "i": 0,
        "startMs": 1000,
        "endMs": None,
        "score": None,
        "interpolated": False,
        "words": [{"word": "hola", "startMs": 1000, "endMs": None, "score": None}],
    }
    assert result[2] == {
        "i": 2,
        "startMs": 3000,
        "endMs": None,
        "score": None,
        "interpolated": False,
        "words": [{"word": "mundo", "startMs": 3000, "endMs": None, "score": None}],
    }
    # interpolacion lineal a mitad de camino entre 1000 y 3000
    assert result[1]["startMs"] == 2000
    assert result[1]["interpolated"] is True
    assert result[1]["score"] is None
    # monotono estrictamente creciente
    starts = [r["startMs"] for r in result]
    assert starts == sorted(set(starts))


def test_monotonicidad_forzada_descarta_ancla_fuera_de_orden():
    """Una palabra que WhisperX marca con un 'start' anterior al de una linea
    ya anclada (glitch de alineado) no debe producir un startMs que retroceda:
    la ancla fuera de orden se descarta y la linea interpola/extrapola."""
    lines = [
        {"i": 0, "text": "hola"},
        {"i": 1, "text": "mundo"},
    ]
    # 'mundo' aparece despues de 'hola' en el stream de palabras (orden de
    # lectura de la linea), pero con un 'start' MENOR — glitch simulado.
    words = [
        {"word": "hola", "start": 5.0},
        {"word": "mundo", "start": 1.0},
    ]

    result = map_words_to_lines(lines, words)

    starts = [r["startMs"] for r in result]
    assert starts == sorted(starts)
    assert len(set(starts)) == len(starts)  # estrictamente creciente, sin duplicados
    assert starts[0] == 5000
    assert starts[1] > starts[0]
    # la ancla de 'mundo' (start=1.0, fuera de orden) se descarta: la linea
    # queda sin ancla propia y por lo tanto interpolada.
    assert result[0]["interpolated"] is False
    assert result[1]["interpolated"] is True
    assert result[1]["score"] is None
    # Misma regla para las palabras: la linea quedo con un startMs interpolado,
    # asi que sus palabras crudas (start=1.0) lo contradicen — no se emiten.
    assert result[1]["words"] == []
    assert result[1]["endMs"] is None


def test_lineas_spoken_participan_igual_alineadas():
    """Una linea 'spoken' (prosa hablada, no cantada) se trata exactamente
    igual que cualquier otra: si WhisperX la reconoce en el audio, ancla."""
    lines = [
        {"i": 0, "text": "santo"},
        {"i": 1, "text": "gracias por venir hoy"},
        {"i": 2, "text": "aleluya"},
    ]
    words = [
        {"word": "santo", "start": 0.5},
        {"word": "gracias", "start": 1.0},
        {"word": "por", "start": 1.2},
        {"word": "venir", "start": 1.4},
        {"word": "hoy", "start": 1.6},
        {"word": "aleluya", "start": 2.0},
    ]

    result = map_words_to_lines(lines, words)

    assert result == [
        {
            "i": 0,
            "startMs": 500,
            "endMs": None,
            "score": None,
            "interpolated": False,
            "words": [{"word": "santo", "startMs": 500, "endMs": None, "score": None}],
        },
        {
            "i": 1,
            "startMs": 1000,
            "endMs": None,
            "score": None,
            "interpolated": False,
            "words": [
                {"word": "gracias", "startMs": 1000, "endMs": None, "score": None},
                {"word": "por", "startMs": 1200, "endMs": None, "score": None},
                {"word": "venir", "startMs": 1400, "endMs": None, "score": None},
                {"word": "hoy", "startMs": 1600, "endMs": None, "score": None},
            ],
        },
        {
            "i": 2,
            "startMs": 2000,
            "endMs": None,
            "score": None,
            "interpolated": False,
            "words": [{"word": "aleluya", "startMs": 2000, "endMs": None, "score": None}],
        },
    ]


def test_lineas_spoken_sin_audio_interpolan_igual_que_cantadas():
    """Si la spoken line NO esta en el audio (WhisperX no la reconoce),
    interpola igual que cualquier linea sin ancla — sin trato especial."""
    lines = [
        {"i": 0, "text": "santo"},
        {"i": 1, "text": "palabra que el predicador dijo pero no quedo grabada"},
        {"i": 2, "text": "aleluya"},
    ]
    words = [
        {"word": "santo", "start": 1.0},
        {"word": "aleluya", "start": 3.0},
    ]

    result = map_words_to_lines(lines, words)

    assert result[1]["startMs"] == 2000
    starts = [r["startMs"] for r in result]
    assert starts == sorted(set(starts))


def test_colision_por_redondeo_fuerza_estrictamente_creciente():
    """Interpolar un tramo muy corto (1ms) sobre varias lineas intermedias
    produce fracciones que redondean al mismo entero; la salida debe seguir
    siendo estrictamente creciente (empujando +1ms en cada colision)."""
    lines = [
        {"i": 0, "text": "uno"},
        {"i": 1, "text": "dos"},
        {"i": 2, "text": "tres"},
        {"i": 3, "text": "cuatro"},
        {"i": 4, "text": "cinco"},
    ]
    words = [
        {"word": "uno", "start": 0.0},
        {"word": "cinco", "start": 0.001},  # 1ms despues del primero
    ]

    result = map_words_to_lines(lines, words)

    starts = [r["startMs"] for r in result]
    assert len(starts) == 5
    # estrictamente creciente: cada uno mayor que el anterior, sin excepcion
    assert all(starts[i] < starts[i + 1] for i in range(len(starts) - 1))
    assert all(isinstance(s, int) for s in starts)


def test_nunca_emite_i_fuera_de_las_lineas_de_entrada():
    lines = [{"i": 0, "text": "hola"}, {"i": 1, "text": "mundo"}]
    words = [{"word": "hola", "start": 1.0}, {"word": "mundo", "start": 2.0}]

    result = map_words_to_lines(lines, words)

    input_is = {line["i"] for line in lines}
    assert {r["i"] for r in result} <= input_is
    assert len(result) == len(lines)


def test_lookahead_maximo_evita_anclar_ocurrencia_lejana_de_token_repetido():
    """Letra con muchas lineas de relleno seguidas de una unica linea 'santo'
    bien al final. Una palabra espuria 'santo' que aparece TEMPRANO en el
    stream de WhisperX (glitch de reconocimiento, ruido, coro de fondo) NO
    debe poder anclar la ocurrencia real de 'santo' que esta 20 tokens mas
    adelante — fuera de _MAX_LOOKAHEAD — arrastrando el cursor de un salto y
    desalineando en silencio el resto de la cancion. Debe descartarse."""
    lines = [{"i": 0, "text": "hola"}]
    for i in range(1, 21):
        lines.append({"i": i, "text": "relleno"})
    lines.append({"i": 21, "text": "santo"})

    words = [
        {"word": "hola", "start": 1.0},
        # Espuria: matchea el token 'santo', pero su unica ocurrencia real
        # esta 20 posiciones mas adelante del cursor (fuera del lookahead).
        {"word": "santo", "start": 1.5},
        {"word": "relleno", "start": 2.0},
    ]

    result = map_words_to_lines(lines, words)
    by_i = {r["i"]: r["startMs"] for r in result}

    assert by_i[0] == 1000
    # La linea 1 ('relleno', la primera ocurrencia tras 'hola') sigue
    # anclando normalmente: si la espuria hubiera arrastrado el cursor hasta
    # la linea 21, esta habria quedado sin su ancla real cercana.
    assert by_i[1] == 2000
    # La ultima linea ('santo', i=21) NO puede llevar el startMs de la
    # palabra espuria (1500ms): al no tener ancla real, interpola/extrapola.
    assert by_i[21] != 1500


def test_sin_palabras_whisperx_genera_rampa_fallback_creciente():
    """words=[] (WhisperX no reconocio nada del audio, o vino vacio): sin
    ninguna ancla posible, se emite igual una salida completa y
    estrictamente creciente (contrato de salida, nunca se rompe)."""
    lines = [{"i": 0, "text": "a"}, {"i": 1, "text": "b"}, {"i": 2, "text": "c"}]

    result = map_words_to_lines(lines, [])

    starts = [r["startMs"] for r in result]
    assert len(result) == 3
    assert all(starts[i] < starts[i + 1] for i in range(len(starts) - 1))
    assert {r["i"] for r in result} == {0, 1, 2}
    assert all(r["interpolated"] is True for r in result)
    assert all(r["score"] is None for r in result)


def test_un_solo_anclaje_usa_pendiente_cero_para_extrapolar():
    """Con exactamente 1 linea anclada en toda la cancion, no hay un segundo
    punto del que inferir pendiente: tanto la extrapolacion hacia atras como
    hacia adelante usan slope=0.0 (todas las lineas sin ancla quedan al
    mismo valor base que la ancla, antes de forzar monotonicidad estricta
    por redondeo)."""
    lines = [
        {"i": 0, "text": "antes uno"},
        {"i": 1, "text": "antes dos"},
        {"i": 2, "text": "ancla"},
        {"i": 3, "text": "despues uno"},
        {"i": 4, "text": "despues dos"},
    ]
    words = [{"word": "ancla", "start": 5.0}]

    result = map_words_to_lines(lines, words)
    starts = [r["startMs"] for r in result]

    # Las 5 lineas parten del mismo valor base (5000ms, slope=0.0) y solo se
    # separan por el empuje +1ms de la monotonicidad estricta al redondear.
    assert starts == [5000, 5001, 5002, 5003, 5004]
