import { describe, expect, it } from 'vitest';
import {
  PHASES, RUN_STATUSES, initialPhases, canStartPhase,
  applyPhaseEvent, phasesAfterLyricsEdit, runStatusFromPhases,
} from '../api/_lib/pipeline/state.js';

describe('modelo de fases', () => {
  it('define las 8 fases del DAG en orden', () => {
    expect(PHASES).toEqual(['upload','stems','structure','transcription','lyrics_review','sync','pitch','clips']);
  });
  it('initialPhases arranca todo pending salvo upload running', () => {
    const p = initialPhases();
    expect(p.upload.status).toBe('running');
    expect(p.stems.status).toBe('pending');
  });
});

describe('dependencias', () => {
  it('stems y transcription requieren upload done (transcription ademas stems.vocals)', () => {
    const p = initialPhases();
    expect(canStartPhase(p, 'stems')).toBe(false);
    p.upload.status = 'done';
    expect(canStartPhase(p, 'stems')).toBe(true);
    expect(canStartPhase(p, 'transcription')).toBe(false);
    p.stems.tracks = { vocals: 'k1' };
    expect(canStartPhase(p, 'transcription')).toBe(true);
  });
  it('sync y pitch requieren lyrics_review done; clips requiere sync done', () => {
    const p = initialPhases();
    p.upload.status = 'done';
    p.stems.status = 'done';
    p.stems.tracks = { vocals: 'k', lead: 'k', backing: 'k' };
    p.transcription.status = 'done';
    expect(canStartPhase(p, 'sync')).toBe(false);
    p.lyrics_review.status = 'done';
    expect(canStartPhase(p, 'sync')).toBe(true);
    expect(canStartPhase(p, 'clips')).toBe(false);
    p.sync.status = 'done';
    expect(canStartPhase(p, 'clips')).toBe(true);
  });
});

describe('applyPhaseEvent (CAS)', () => {
  it('acepta done sobre running y publica artifacts', () => {
    const p = initialPhases();
    p.stems.status = 'running';
    const next = applyPhaseEvent(p, { phase: 'stems', ok: true, tracks: { vocals: 'k1' } });
    expect(next.stems.status).toBe('done');
    expect(next.stems.tracks.vocals).toBe('k1');
  });
  it('rechaza eventos tardios sobre una fase ya terminal (zombie)', () => {
    const p = initialPhases();
    p.stems.status = 'done';
    const next = applyPhaseEvent(p, { phase: 'stems', ok: false, error: 'late' });
    expect(next).toBe(null); // null = evento ignorado
  });
  it('merge parcial de tracks de stems (publicacion progresiva por pista)', () => {
    const p = initialPhases();
    p.stems.status = 'running';
    const n1 = applyPhaseEvent(p, { phase: 'stems', ok: true, partial: true, tracks: { vocals: 'k1', instrumental: 'k2' } });
    expect(n1.stems.status).toBe('running');
    const n2 = applyPhaseEvent(n1, { phase: 'stems', ok: true, tracks: { lead: 'k3', backing: 'k4' } });
    expect(n2.stems.status).toBe('done');
    expect(Object.keys(n2.stems.tracks).sort()).toEqual(['backing','instrumental','lead','vocals']);
  });
  it('acepta tracks parciales sobre stems done sin cambiar status', () => {
    const phases = { ...initialPhases(), stems: { status: 'done', error: null, tracks: { lead: 'k/lead' } } };
    const next = applyPhaseEvent(phases, { phase: 'stems', ok: true, partial: true, tracks: { drums: 'k/drums' } });
    expect(next.stems.status).toBe('done');
    expect(next.stems.tracks).toEqual({ lead: 'k/lead', drums: 'k/drums' });
  });
  it('sigue ignorando eventos no-parciales o fallidos sobre fase terminal', () => {
    const phases = { ...initialPhases(), stems: { status: 'done' } };
    expect(applyPhaseEvent(phases, { phase: 'stems', ok: false, error: 'x' })).toBeNull();
    expect(applyPhaseEvent(phases, { phase: 'stems', ok: true, partial: false })).toBeNull();
  });
  it('NO mergea tracks parciales sobre stems failed (evita despachar transcription con stems fallida)', () => {
    const phases = { ...initialPhases(), stems: { status: 'failed', error: 'boom' } };
    const next = applyPhaseEvent(phases, { phase: 'stems', ok: true, partial: true, tracks: { vocals: 'k/vocals' } });
    expect(next).toBeNull();
  });
});

describe('invalidacion en cascada', () => {
  it('editar la letra aprobada marca sync/pitch/clips stale y no toca stems', () => {
    const p = initialPhases();
    for (const ph of PHASES) p[ph].status = 'done';
    const next = phasesAfterLyricsEdit(p);
    expect(next.sync.status).toBe('stale');
    expect(next.pitch.status).toBe('stale');
    expect(next.clips.status).toBe('stale');
    expect(next.stems.status).toBe('done');
  });
});

describe('runStatusFromPhases', () => {
  it('awaiting_lyrics cuando transcription done y lyrics_review pending', () => {
    const p = initialPhases();
    p.upload.status = 'done'; p.stems.status = 'done'; p.transcription.status = 'done';
    expect(runStatusFromPhases(p)).toBe('awaiting_lyrics');
  });
  it('done cuando sync+pitch+clips done', () => {
    const p = initialPhases();
    for (const ph of PHASES) p[ph].status = 'done';
    expect(runStatusFromPhases(p)).toBe('done');
  });
  it('failed solo si una fase requerida fallo sin retry pendiente', () => {
    const p = initialPhases();
    p.upload.status = 'done'; p.stems.status = 'failed';
    expect(runStatusFromPhases(p)).toBe('processing'); // otras fases siguen
  });
  it('runStatusFromPhases ignora structure para done', () => {
    const p = initialPhases();
    for (const ph of PHASES) p[ph].status = 'done';
    p.structure.status = 'failed';
    expect(runStatusFromPhases(p)).toBe('done');
  });
});
