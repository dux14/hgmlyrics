// Endpoint de realineado de tiempos (sesión 6 del refactor de revisión de letra).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin1', email: 'a@a.com' })),
}));
vi.mock('../api/_lib/align.js', () => ({
  dispatchAlign: vi.fn(async () => ({ id: 'call1' })),
}));

import sql from '../api/_lib/db.js';
import { requireAdmin } from '../api/_lib/auth.js';
import { dispatchAlign } from '../api/_lib/align.js';
import { initialPhases } from '../api/_lib/pipeline/state.js';
import realignHandler from '../api/songs/[id]/pipeline/realign.js';
import { makeRes } from './helpers/makeRes.js';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: 'admin1', email: 'a@a.com' });
  dispatchAlign.mockResolvedValue({ id: 'call1' });
});

// Mismo patrón que tests/pipelineLyricsEndpoint.test.js: cola de handlers por
// coincidencia de texto del SQL, sin distinguir límites de transacción.
function routeSql(handlers) {
  const calls = [];
  sql.mockImplementation(async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    for (const [needle, result] of handlers) {
      if (text.includes(needle)) {
        if (typeof result === 'function') return result(values, text);
        if (result && result.__reject) return Promise.reject(result.__reject);
        return result;
      }
    }
    return [];
  });
  sql.json = (o) => o;
  sql.begin = async (cb) => cb(sql);
  sql.calls = calls;
  return calls;
}

function syncedPhases() {
  const phases = initialPhases();
  for (const ph of ['upload', 'stems', 'structure', 'transcription', 'lyrics_review', 'sync']) {
    phases[ph] = { ...phases[ph], status: 'done' };
  }
  phases.pitch = { ...phases.pitch, status: 'done' };
  phases.clips = { ...phases.clips, status: 'done' };
  return phases;
}

const SECTIONS = [
  {
    type: 'verse',
    lines: [
      { text: 'uno', startMs: 1000, endMs: 1800, manualStartMs: 1200, words: [] },
      { text: 'dos', startMs: 2000, endMs: 2800, manualStartMs: null, words: [] },
    ],
  },
];

function req(overrides = {}) {
  return { method: 'POST', query: { id: 's1' }, body: {}, headers: {}, ...overrides };
}

// Fila de song_pipeline_lyrics tal como la devuelve getPipelineLyrics.
function lyricsRow(extra = {}) {
  return [
    {
      songId: 's1',
      runId: 'r1',
      sections: SECTIONS,
      hash: 'hash-viejo',
      language: 'es',
      approvedAt: '2026-07-30T00:00:00Z',
      previousSections: null,
      previousHash: null,
      realignedAt: null,
      ...extra,
    },
  ];
}

function runRow(phases = syncedPhases(), status = 'done') {
  return [{ id: 'r1', songId: 's1', status, phases }];
}

describe('POST /api/songs/:id/pipeline/realign', () => {
  it('403 si no es admin', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    routeSql([]);
    const res = makeRes();
    await realignHandler(req(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dispatchAlign).not.toHaveBeenCalled();
  });

  it('409 si no hay letra aprobada', async () => {
    routeSql([
      ['FROM song_pipeline_runs', runRow()],
      ['FROM song_pipeline_lyrics', []],
    ]);
    const res = makeRes();
    await realignHandler(req(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/letra aprobada/i);
    expect(dispatchAlign).not.toHaveBeenCalled();
  });

  it('409 si sync ya está corriendo', async () => {
    const phases = syncedPhases();
    phases.sync = { ...phases.sync, status: 'running' };
    routeSql([
      ['FROM song_pipeline_runs', runRow(phases, 'processing')],
      ['FROM song_pipeline_lyrics', lyricsRow()],
    ]);
    const res = makeRes();
    await realignHandler(req(), res);
    expect(res.statusCode).toBe(409);
    expect(dispatchAlign).not.toHaveBeenCalled();
  });

  it('409 si sync está en failed (ese camino es el reintento)', async () => {
    const phases = syncedPhases();
    phases.sync = { ...phases.sync, status: 'failed' };
    routeSql([
      ['FROM song_pipeline_runs', runRow(phases, 'processing')],
      ['FROM song_pipeline_lyrics', lyricsRow()],
    ]);
    const res = makeRes();
    await realignHandler(req(), res);
    expect(res.statusCode).toBe(409);
    expect(dispatchAlign).not.toHaveBeenCalled();
  });

  it('camino feliz: respalda, limpia los manuales y despacha', async () => {
    const calls = routeSql([
      ['FROM song_pipeline_runs', runRow()],
      ['FROM song_pipeline_lyrics', lyricsRow()],
    ]);
    const res = makeRes();
    await realignHandler(req(), res);

    expect(res.statusCode).toBe(200);

    const backup = calls.find((c) => c.text.includes('UPDATE song_pipeline_lyrics'));
    expect(backup).toBeDefined();
    // El respaldo copia columna a columna en la misma escritura: no puede
    // divergir del documento que se está por pisar.
    expect(backup.text).toMatch(/previous_sections = sections/);
    expect(backup.text).toMatch(/previous_hash = hash/);
    expect(backup.text).toMatch(/realigned_at = now\(\)/);
    // El documento nuevo va sin ningún ajuste manual.
    const written = backup.values.find((v) => Array.isArray(v) && v[0]?.lines?.length);
    expect(written[0].lines.map((l) => l.manualStartMs)).toEqual([null, null]);

    const timings = calls.find((c) => c.text.includes('INSERT INTO song_line_timings'));
    expect(timings.text).toMatch(/'processing'/);
    // Derivados del documento limpio: el manual de 1200 no sobrevive.
    const derived = timings.values.find((v) => Array.isArray(v));
    expect(derived.map((l) => l.startMs)).toEqual([1000, 2000]);

    const runUpdate = calls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    const phases = runUpdate.values.find((v) => v && v.sync);
    expect(phases.sync.status).toBe('running');
    expect(phases.pitch.status).toBe('pending');
    expect(phases.clips.status).toBe('pending');

    expect(dispatchAlign).toHaveBeenCalledTimes(1);
    // Se despacha con el hash del documento limpio, no con el viejo.
    expect(dispatchAlign.mock.calls[0][0]).toBe('s1');
    expect(dispatchAlign.mock.calls[0][1]).not.toBe('hash-viejo');
    // El claim transaccional (FOR UPDATE sobre el run) ya garantiza la
    // exclusión: dispatchAlign no puede re-derivarla leyendo el
    // song_line_timings que este mismo endpoint acaba de dejar en
    // 'processing', o se rechaza a sí mismo con 409 (el blocker real).
    expect(dispatchAlign.mock.calls[0][2]).toMatchObject({ alreadyClaimedByCaller: true });
  });

  it('el UPDATE del run lleva el approvedHash nuevo, coincidiendo con el hash despachado', async () => {
    const calls = routeSql([
      ['FROM song_pipeline_runs', runRow()],
      ['FROM song_pipeline_lyrics', lyricsRow()],
    ]);
    const res = makeRes();
    await realignHandler(req(), res);

    expect(res.statusCode).toBe(200);
    const runUpdate = calls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    const lyricsReview = runUpdate.values.find(
      (v) => v && typeof v === 'object' && 'approvedHash' in v,
    );
    expect(lyricsReview).toBeDefined();
    expect(lyricsReview.approvedHash).toBe(dispatchAlign.mock.calls[0][1]);
  });

  it('502 y sync en failed si el dispatch falla', async () => {
    const calls = routeSql([
      ['FROM song_pipeline_runs', runRow()],
      ['FROM song_pipeline_lyrics', lyricsRow()],
      ['FROM song_line_timings', [{ status: 'ready', lines: [], provider: 'pipeline', error: null }]],
    ]);
    dispatchAlign.mockRejectedValueOnce(new Error('Modal caído'));
    const res = makeRes();
    await realignHandler(req(), res);

    expect(res.statusCode).toBe(502);
    const runUpdates = calls.filter((c) => c.text.includes('UPDATE song_pipeline_runs'));
    const last = runUpdates[runUpdates.length - 1];
    const phases = last.values.find((v) => v && v.sync);
    expect(phases.sync.status).toBe('failed');
    expect(phases.sync.error).toMatch(/Modal caído/);
  });

  it('dispatch fallido: song_line_timings vuelve al estado previo (no queda colgado en processing)', async () => {
    const calls = routeSql([
      ['FROM song_pipeline_runs', runRow()],
      ['FROM song_pipeline_lyrics', lyricsRow()],
      // Estado previo a este realineado: ya tenía tiempos 'ready' de un align anterior.
      ['FROM song_line_timings', [{ status: 'ready', lines: [{ i: 0 }], provider: 'pipeline', error: null }]],
    ]);
    dispatchAlign.mockRejectedValueOnce(new Error('Modal caído'));
    const res = makeRes();
    await realignHandler(req(), res);

    expect(res.statusCode).toBe(502);
    const timingsUpdates = calls.filter(
      (c) => c.text.includes('UPDATE song_line_timings') || c.text.includes('DELETE FROM song_line_timings'),
    );
    const revert = timingsUpdates[timingsUpdates.length - 1];
    expect(revert).toBeDefined();
    expect(revert.text).toMatch(/status = 'ready'|status = \?/);
    expect(revert.values.flat()).toContain('ready');
  });

  it('dispatch fallido y sin fila previa en song_line_timings: la deja borrada, no colgada en processing', async () => {
    const calls = routeSql([
      ['FROM song_pipeline_runs', runRow()],
      ['FROM song_pipeline_lyrics', lyricsRow()],
      ['FROM song_line_timings', []], // sin fila previa
    ]);
    dispatchAlign.mockRejectedValueOnce(new Error('Modal caído'));
    const res = makeRes();
    await realignHandler(req(), res);

    expect(res.statusCode).toBe(502);
    const del = calls.find((c) => c.text.includes('DELETE FROM song_line_timings'));
    expect(del).toBeDefined();
  });
});

function undoReq() {
  return req({ query: { id: 's1', undo: '1' } });
}

function backupRow(extra = {}) {
  return [
    {
      sections: SECTIONS,
      hash: 'hash-nuevo',
      previousSections: SECTIONS,
      previousHash: 'hash-viejo',
      ...extra,
    },
  ];
}

describe('POST /api/songs/:id/pipeline/realign?undo=1', () => {
  it('409 si no hay un realineado para deshacer (sin respaldo)', async () => {
    routeSql([['FROM song_pipeline_lyrics', backupRow({ previousSections: null, previousHash: null })]]);
    const res = makeRes();
    await realignHandler(undoReq(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/no hay un realineado para deshacer/i);
    expect(dispatchAlign).not.toHaveBeenCalled();
  });

  it('409 si no hay fila en song_pipeline_lyrics', async () => {
    routeSql([['FROM song_pipeline_lyrics', []]]);
    const res = makeRes();
    await realignHandler(undoReq(), res);
    expect(res.statusCode).toBe(409);
    expect(dispatchAlign).not.toHaveBeenCalled();
  });

  it('camino feliz: restaura el respaldo, deja las 3 columnas en null, re-deriva timings y no despacha', async () => {
    const calls = routeSql([
      ['FROM song_pipeline_lyrics', backupRow()],
      ['FROM song_pipeline_runs', runRow()],
    ]);
    const res = makeRes();
    await realignHandler(undoReq(), res);

    expect(res.statusCode).toBe(200);

    const restore = calls.find((c) => c.text.includes('UPDATE song_pipeline_lyrics'));
    expect(restore).toBeDefined();
    expect(restore.text).toMatch(/sections = previous_sections/);
    expect(restore.text).toMatch(/hash = previous_hash/);
    expect(restore.text).toMatch(/previous_sections = null/);
    expect(restore.text).toMatch(/previous_hash = null/);
    expect(restore.text).toMatch(/realigned_at = null/);

    const timings = calls.find((c) => c.text.includes('song_line_timings'));
    expect(timings.text).toMatch(/'ready'/);
    const derived = timings.values.find((v) => Array.isArray(v));
    // El respaldo restaura tal cual (sin limpiar manualStartMs, a diferencia
    // del camino de realinear): SECTIONS trae manualStartMs=1200 en 'uno'.
    expect(derived.map((l) => l.startMs)).toEqual([1200, 2000]);

    const runUpdate = calls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    const phases = runUpdate.values.find((v) => v && v.sync);
    expect(phases.sync.status).toBe('done');
    expect(phases.pitch.status).toBe('stale');
    expect(phases.clips.status).toBe('stale');
    const lyricsReview = runUpdate.values.find(
      (v) => v && typeof v === 'object' && 'approvedHash' in v,
    );
    expect(lyricsReview.approvedHash).toBe('hash-viejo');

    expect(dispatchAlign).not.toHaveBeenCalled();
  });
});
