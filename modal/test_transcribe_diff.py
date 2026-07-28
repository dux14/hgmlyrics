"""Diff transcripcion <-> letra DB <-> canonica, por linea, con jiwer."""
from transcribe_diff import line_scores, normalize_for_compare


def test_normalize_quita_tildes_puntuacion_case():
    assert normalize_for_compare("¡Brillará tu Luz!") == "brillara tu luz"


def test_line_scores_alinea_por_mejor_match():
    trans_lines = ["nadie me ama como tu", "brillara tu luz"]
    db_lines = ["Nadie me ama como tú", "brillará"]
    scores = line_scores(trans_lines, db_lines)
    assert scores[0]["score"] == 1.0          # match exacto normalizado
    assert 0 < scores[1]["score"] < 1.0        # parcial
    assert scores[1]["dbIndex"] == 1
