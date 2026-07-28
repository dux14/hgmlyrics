# Verifica que ambos motores de F0 devuelven el mismo contrato
# {"times","f0","conf"} (float32, misma longitud), sin GPU: se testea la
# funcion de post-proceso con arrays sinteticos.
import numpy as np
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from f0 import _as_f0_contract


def test_contract_shapes_and_dtypes():
    times = np.arange(5, dtype=np.float64) * 0.01
    f0 = np.array([0.0, 220.0, 221.0, 0.0, 230.0], dtype=np.float64)
    conf = np.array([0.1, 0.9, 0.8, 0.05, 0.7], dtype=np.float64)
    out = _as_f0_contract(times, f0, conf)
    assert set(out.keys()) == {"times", "f0", "conf"}
    for k in out:
        assert out[k].dtype == np.float32
        assert out[k].shape == (5,)


def test_contract_rejects_length_mismatch():
    import pytest
    with pytest.raises(ValueError):
        _as_f0_contract(np.zeros(3), np.zeros(4), np.zeros(3))
