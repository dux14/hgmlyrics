# modal/pitch/tests/test_run_pipeline_run_id.py
"""
Fix CRITICAL 3 (auditoria de pipeline, 27-jul): `run_pipeline` (modo pipeline
unificado) debe postear al webhook el `runId` REAL de song_pipeline_runs, NO
el `jobId` que puede venir versionado por ciclo de letra
(`${run.id}:${snapshotHash}`, ver dispatchPitch en api/_lib/pipeline/dispatch.js)
-- de otro modo process.js (`WHERE id = ${runId}`) nunca encuentra la fila.

Monkeypatchea los nodos (n_f0/n_notes/n_lyrics/n_fusion/n_render) y
post_pipeline_event con fakes puros; corre run_pipeline.local() (sin Modal
runtime real) en modo pipeline (input.leadGetUrl/backingGetUrl).
"""
from __future__ import annotations

import pitch_app


class _FakeCall:
    def __init__(self, value):
        self._value = value

    def remote(self, *a, **k):
        return self._value


def _patch_download(monkeypatch):
    monkeypatch.setattr(pitch_app, "download_bytes", lambda url: b"x")
    monkeypatch.setenv("PITCH_MODAL_INBOUND_SECRET", "test-secret")


def _patch_nodes(monkeypatch):
    monkeypatch.setattr(pitch_app, "n_f0", _FakeCall((b"lead_f0", b"backing_f0")))
    monkeypatch.setattr(pitch_app, "n_notes", _FakeCall((b"notes_lead", b"notes_backing")))
    monkeypatch.setattr(pitch_app, "n_lyrics", _FakeCall({}))
    monkeypatch.setattr(pitch_app, "n_fusion", _FakeCall({"lines": []}))
    monkeypatch.setattr(pitch_app, "n_render", _FakeCall({}))


def test_run_pipeline_postea_runId_real_no_jobId_versionado(monkeypatch):
    events = []
    monkeypatch.setattr(
        pitch_app, "post_pipeline_event",
        lambda webhook, run_id, ok, **kw: events.append((run_id, ok, kw)),
    )
    _patch_download(monkeypatch)
    _patch_nodes(monkeypatch)

    payload = {
        "jobId": "run1:hashA",  # versionado por ciclo (fix CRITICAL 3)
        "runId": "run1",  # id real de song_pipeline_runs
        "webhook": {"url": "https://x/webhook"},
        "signUploadUrl": "https://x/sign",
        "input": {
            "leadGetUrl": "https://get/lead.mp3",
            "backingGetUrl": "https://get/backing.mp3",
            "snapshotHash": "hashA",
        },
    }
    pitch_app.run_pipeline.local(payload)

    assert len(events) == 1
    run_id, ok, kw = events[0]
    assert run_id == "run1"  # NO "run1:hashA"
    assert ok is True


def test_run_pipeline_sin_runId_cae_a_jobId(monkeypatch):
    # Comportamiento previo al fix, preservado para callers que aun no manden
    # runId (p.ej. approve.js standalone, fuera de este dispatch).
    events = []
    monkeypatch.setattr(
        pitch_app, "post_pipeline_event",
        lambda webhook, run_id, ok, **kw: events.append((run_id, ok, kw)),
    )
    _patch_download(monkeypatch)
    _patch_nodes(monkeypatch)

    payload = {
        "jobId": "run1",
        "webhook": {"url": "https://x/webhook"},
        "signUploadUrl": "https://x/sign",
        "input": {
            "leadGetUrl": "https://get/lead.mp3",
            "backingGetUrl": "https://get/backing.mp3",
        },
    }
    pitch_app.run_pipeline.local(payload)

    assert events[0][0] == "run1"


def test_run_pipeline_fallo_intermedio_postea_runId_real(monkeypatch):
    # fail_all (fix HIGH 4 + CRITICAL 3 combinados): un fallo intermedio del
    # modo pipeline tambien debe postear el runId real, no el jobId versionado.
    events = []
    monkeypatch.setattr(
        pitch_app, "post_pipeline_event",
        lambda webhook, run_id, ok, **kw: events.append((run_id, ok, kw)),
    )
    _patch_download(monkeypatch)
    monkeypatch.setattr(pitch_app, "n_f0", _FakeCall((b"lead_f0", b"backing_f0")))
    monkeypatch.setattr(pitch_app, "n_notes", _FakeCall((b"notes_lead", b"notes_backing")))

    def _raise(*a, **k):
        raise RuntimeError("letra fallo")

    class _FailingCall:
        def remote(self, *a, **k):
            _raise()

    monkeypatch.setattr(pitch_app, "n_lyrics", _FailingCall())

    payload = {
        "jobId": "run1:hashA",
        "runId": "run1",
        "webhook": {"url": "https://x/webhook"},
        "signUploadUrl": "https://x/sign",
        "input": {
            "leadGetUrl": "https://get/lead.mp3",
            "backingGetUrl": "https://get/backing.mp3",
            "snapshotHash": "hashA",
        },
    }
    pitch_app.run_pipeline.local(payload)

    assert len(events) == 1
    run_id, ok, kw = events[0]
    assert run_id == "run1"
    assert ok is False
    assert kw.get("snapshot_hash") == "hashA"
