# modal/test_align_transcribe_validation.py
"""
Tests puros (sin GPU, sin Modal runtime) de _validate_transcribe_payload en
align_app.py. Fix CRITICAL 1 de la auditoria de pipeline (27-jul): el caso de
uso central de la fase 'transcription' es una cancion SIN letra todavia (la
IA la va a producir) -- dbLines debe ser opcional, no obligatorio.

Correr con: cd modal && python3 -m pytest test_align_transcribe_validation.py -q
"""

from __future__ import annotations

from align_app import _validate_transcribe_payload


def _base_payload(**overrides):
    payload = {
        "runId": "run1",
        "vocalsGetUrl": "https://example.com/vocals.mp3",
        "webhookUrl": "https://example.com/webhook",
    }
    payload.update(overrides)
    return payload


def test_validate_transcribe_payload_ok_con_dbLines():
    assert _validate_transcribe_payload(_base_payload(dbLines=["hola"])) is None


def test_validate_transcribe_payload_ok_sin_dbLines():
    # Cancion sin letra todavia: dbLines ausente ya NO es un 400 -- la fase
    # transcription existe justo para producir la letra por primera vez.
    assert _validate_transcribe_payload(_base_payload()) is None


def test_validate_transcribe_payload_ok_con_dbLines_vacio():
    assert _validate_transcribe_payload(_base_payload(dbLines=[])) is None


def test_validate_transcribe_payload_sin_runId():
    payload = _base_payload()
    del payload["runId"]
    assert _validate_transcribe_payload(payload) is not None


def test_validate_transcribe_payload_sin_vocalsGetUrl():
    payload = _base_payload()
    del payload["vocalsGetUrl"]
    assert _validate_transcribe_payload(payload) is not None


def test_validate_transcribe_payload_sin_webhookUrl():
    payload = _base_payload()
    del payload["webhookUrl"]
    assert _validate_transcribe_payload(payload) is not None
