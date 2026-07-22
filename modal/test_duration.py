"""Tests puros (sin GPU, sin modal, sin audio real) de duration_from_samples
en sections/_common.py — usada por S1 (extract.py) y S3 (lead_backing.py)
para calcular la duracion del audio de entrada decodificado y mandarla en el
payload del webhook (Task 7: durationSec server-side, adios best-effort del
browser).

Correr con: cd modal && python3 -m pytest test_duration.py -q
"""

from __future__ import annotations

import numpy as np

from sections._common import duration_from_samples


def test_mono_1d():
    # 44100 samples a 44100 Hz == 1 segundo exacto.
    samples = np.zeros(44100, dtype=np.float32)
    assert duration_from_samples(samples, 44100) == 1.0


def test_estereo_2d_usa_el_eje_temporal_no_la_cantidad_de_canales():
    # librosa con mono=False devuelve forma (canales, n) — el eje temporal es
    # el ULTIMO eje, no simplemente len() del array (que daria la cantidad de
    # canales, 2, en vez de la duracion real).
    samples = np.zeros((2, 132300), dtype=np.float32)  # estereo, 3s a 44100Hz
    assert duration_from_samples(samples, 44100) == 3.0


def test_lista_plana_sin_numpy():
    # Debe funcionar tambien sobre una lista python comun (sin atributo .shape).
    samples = [0.0] * 22050
    assert duration_from_samples(samples, 22050) == 1.0


def test_no_redondea_segundos_fraccionarios():
    samples = np.zeros(11113, dtype=np.float32)
    assert duration_from_samples(samples, 44100) == 11113 / 44100
