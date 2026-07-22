# modal/test_stems_orchestration.py
"""
Tests puros (sin GPU, sin Modal runtime) de la orquestacion del DAG de stems
en stems_app.py: plan_sections (paralelizacion total, Task 9) y
_validate_stems_payload (guarda de payload antes del .spawn(), mismo patron
que _validate_align_payload en align_app.py).

Correr con: cd modal && python3 -m pytest test_stems_orchestration.py -q
"""

from __future__ import annotations

from stems_app import _validate_stems_payload, plan_sections


def test_plan_sections_lanza_las_5_en_una_sola_fase():
    # Con las 5 secciones habilitadas, plan_sections devuelve una unica lista
    # (una sola fase) con las 5 -- NO dos fases (Fase A / Fase B previas).
    plan = plan_sections(["structure", "leadBacking", "gender", "duet"])
    assert plan == ["voiceInstrumental", "structure", "leadBacking", "gender", "duet"]


def test_plan_sections_voiceInstrumental_siempre_corre():
    # S1 corre siempre, sin importar enabledSections (mismo criterio que
    # ENABLED_SECTIONS en api/songs/[id]/pipeline/_dispatch.js).
    assert plan_sections([]) == ["voiceInstrumental"]


def test_plan_sections_respeta_subset_habilitado():
    plan = plan_sections(["leadBacking"])
    assert plan == ["voiceInstrumental", "leadBacking"]


def test_validate_stems_payload_ok():
    payload = {
        "jobId": "job1",
        "input": {"getUrl": "https://example.com/audio.mp3"},
        "uploads": {"voiceInstrumental": {"vocals": "https://example.com/put"}},
        "webhook": {"url": "https://example.com/webhook", "secret": "s3cr3t"},
    }
    assert _validate_stems_payload(payload) is None


def test_validate_stems_payload_sin_jobId():
    payload = {
        "input": {"getUrl": "https://example.com/audio.mp3"},
        "uploads": {"voiceInstrumental": {}},
        "webhook": {"url": "https://example.com/webhook", "secret": "s3cr3t"},
    }
    assert _validate_stems_payload(payload) is not None


def test_validate_stems_payload_sin_input_getUrl():
    payload = {
        "jobId": "job1",
        "input": {},
        "uploads": {"voiceInstrumental": {}},
        "webhook": {"url": "https://example.com/webhook", "secret": "s3cr3t"},
    }
    assert _validate_stems_payload(payload) is not None


def test_validate_stems_payload_sin_uploads():
    payload = {
        "jobId": "job1",
        "input": {"getUrl": "https://example.com/audio.mp3"},
        "uploads": {},
        "webhook": {"url": "https://example.com/webhook", "secret": "s3cr3t"},
    }
    assert _validate_stems_payload(payload) is not None


def test_validate_stems_payload_sin_webhook():
    payload = {
        "jobId": "job1",
        "input": {"getUrl": "https://example.com/audio.mp3"},
        "uploads": {"voiceInstrumental": {}},
    }
    assert _validate_stems_payload(payload) is not None
