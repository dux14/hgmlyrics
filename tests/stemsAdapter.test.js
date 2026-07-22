import { describe, it, expect } from 'vitest';
import { sectionEventToPhaseEvent } from '../api/_lib/pipeline/stemsAdapter.js';

describe('sectionEventToPhaseEvent', () => {
  it('leadBacking done → finaliza la fase stems (ok, sin partial) con los 3 tracks', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'leadBacking',
      result: { status: 'done', model: 'karaoke', outputs: { lead: 'k-lead', backing: 'k-back', vocals: 'k-voc' } },
    });
    expect(out).toEqual({
      runId: 'run-1',
      phase: 'stems',
      ok: true,
      partial: false,
      tracks: { lead: 'k-lead', backing: 'k-back', vocals: 'k-voc' },
    });
  });

  it('leadBacking failed → falla la fase stems', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'leadBacking',
      result: { status: 'failed', model: 'karaoke', outputs: {} },
      error: 'boom',
    });
    expect(out).toEqual({ runId: 'run-1', phase: 'stems', ok: false, error: 'boom' });
  });

  it('voiceInstrumental done con outputs vacíos → partial sin tracks', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'voiceInstrumental',
      result: { status: 'done', model: 'x', outputs: {} },
    });
    expect(out).toEqual({ runId: 'run-1', phase: 'stems', ok: true, partial: true, tracks: {} });
  });

  it('gender failed → ignorado (null), no falla la fase stems', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'gender',
      result: { status: 'failed', model: 'x', outputs: {} },
      error: 'sin género detectado',
    });
    expect(out).toBeNull();
  });

  it('filtra entradas null/undefined de outputs (secciones sin upload slot)', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'gender',
      result: { status: 'done', model: 'x', outputs: { male: null, female: undefined } },
    });
    expect(out.tracks).toEqual({});
  });

  it('sin result (ni outputs) → ignorado (null), no revienta leyendo outputs', () => {
    const out = sectionEventToPhaseEvent({ jobId: 'run-1', section: 'leadBacking' });
    expect(out).toBeNull();
  });

  it('leadBacking status running → ignorado (null), no finaliza la fase aun', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'leadBacking',
      result: { status: 'running', model: 'karaoke', outputs: {} },
    });
    expect(out).toBeNull();
  });

  it('leadBacking sin status → ignorado (null), no finaliza la fase aun', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'leadBacking',
      result: { model: 'karaoke', outputs: {} },
    });
    expect(out).toBeNull();
  });

  it('voiceInstrumental status running → ignorado (null), sección no finalizadora sin resultado aun', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'voiceInstrumental',
      result: { status: 'running', model: 'x', outputs: {} },
    });
    expect(out).toBeNull();
  });

  it('gender sin status → ignorado (null), sección no finalizadora sin resultado aun', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'gender',
      result: { model: 'x', outputs: {} },
    });
    expect(out).toBeNull();
  });

  it('structure done → fase structure con segments en ms (conversion de segundos una sola vez)', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'structure',
      result: {
        status: 'done',
        model: 'songformer',
        segments: [{ label: 'coro', start: 64.2, end: 105.8 }],
      },
    });
    expect(out).toEqual({
      runId: 'run-1',
      phase: 'structure',
      ok: true,
      partial: false,
      payload: { segments: [{ label: 'coro', startMs: 64200, endMs: 105800 }], model: 'songformer' },
    });
  });

  it('structure failed → fase structure falla (NO null: fila visible con retry, aunque no bloquee el run)', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'structure',
      result: { status: 'failed', model: 'songformer' },
      error: 'timeout de inferencia',
    });
    expect(out).toEqual({ runId: 'run-1', phase: 'structure', ok: false, error: 'timeout de inferencia' });
  });

  it('structure status running → ignorado (null), aun no hay resultado', () => {
    const out = sectionEventToPhaseEvent({
      jobId: 'run-1',
      section: 'structure',
      result: { status: 'running', model: 'songformer' },
    });
    expect(out).toBeNull();
  });
});
