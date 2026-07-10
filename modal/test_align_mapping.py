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


# ──────────────────────────────────────────────────────────────────────────────
# map_words_to_lines()
# ──────────────────────────────────────────────────────────────────────────────

def test_tokens_silabicos_anclan_palabra_completa_de_whisperx():
    """'santo' (WhisperX) debe anclar la linea silabica 'Sa - a - an - to'."""
    lines = [{"i": 0, "text": "Sa - a - an - to"}]
    words = [{"word": "Santo", "start": 1.2}]

    result = map_words_to_lines(lines, words)

    assert result == [{"i": 0, "startMs": 1200}]


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

    assert result[0] == {"i": 0, "startMs": 1000}
    assert result[2] == {"i": 2, "startMs": 3000}
    # interpolacion lineal a mitad de camino entre 1000 y 3000
    assert result[1] == {"i": 1, "startMs": 2000}
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
        {"i": 0, "startMs": 500},
        {"i": 1, "startMs": 1000},
        {"i": 2, "startMs": 2000},
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
