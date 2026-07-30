/**
 * pipelineRealignCuelgue.test.js — TDD para el cuelgue heredado (Task 7 del
 * plan S6): si el webhook del realineado se pierde, song_line_timings queda
 * en 'processing' para siempre y el auto-retry choca en bucle contra el 409
 * de dispatchAlign (api/_lib/align.js:80).
 *
 * Dos frentes que comparten el mismo cliente sql: cleanup.js y align.js
 * importan el mismo módulo `api/_lib/db.js`, así que un único mock de
 * 'postgres' (no de db.js directo) sirve a ambos con la misma cola de
 * respuestas — todos los vi.mock van a nivel de módulo (hoisted), nunca
 * dentro de un describe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRes } from './helpers/makeRes.js';
import { initialPhases } from '../api/_lib/pipeline/state.js';

// ── Mocks compartidos por ambos frentes ─────────────────────────────────────
const mockDeleteSongAudioObject = vi.fn();
const mockDeleteSongAudioObjects = vi.fn();
vi.mock('../api/_lib/storage.js', () => ({
  deleteSongAudioObject: mockDeleteSongAudioObject,
  deleteSongAudioObjects: mockDeleteSongAudioObjects,
  signSongAudioDownload: vi.fn((key) => Promise.resolve(`https://get/${key}`)),
}));

const mockRetryPhase = vi.fn();
vi.mock('../api/_lib/pipeline/retryPhase.js', () => ({ retryPhase: mockRetryPhase }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

// sql mock de cleanup.js (vía 'postgres', mismo patrón que apiPipelineCleanup.test.js)
const topLevelResponses = [];
const sqlResponses = [];
const capturedInnerQueries = [];
function makeInnerSql() {
  const inner = (strings) => {
    if (!strings?.raw) return strings;
    capturedInnerQueries.push(strings.raw.join('?'));
    return Promise.resolve(sqlResponses.shift() ?? []);
  };
  inner.json = (v) => v;
  return inner;
}
function cleanupSqlMock(strings) {
  if (!strings?.raw) return strings;
  return Promise.resolve(topLevelResponses.shift() ?? []);
}
cleanupSqlMock.json = (v) => v;
cleanupSqlMock.begin = async (cb) => cb(makeInnerSql());
vi.mock('postgres', () => ({ default: () => cleanupSqlMock }));

vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
  fetchWithTimeout: vi.fn(async () => ({ ok: true })),
  MODAL_DISPATCH_TIMEOUT_MS: 30000,
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';
process.env.MODAL_ALIGN_ENDPOINT = 'https://modal.example/align';
process.env.MODAL_INBOUND_SECRET = 'inbound-secret';
process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';
process.env.CRON_SECRET = 'supersecret';

const cleanupHandler = (await import('../api/pipeline/cleanup.js')).default;
const { dispatchAlign } = await import('../api/_lib/align.js');
const { fetchWithTimeout } = await import('../api/_lib/http.js');

function makeReq() {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer supersecret' },
    query: {},
    body: {},
  };
}

beforeEach(() => {
  topLevelResponses.length = 0;
  sqlResponses.length = 0;
  capturedInnerQueries.length = 0;
  mockDeleteSongAudioObject.mockReset().mockResolvedValue(undefined);
  mockDeleteSongAudioObjects.mockReset().mockResolvedValue(undefined);
  mockRetryPhase.mockReset().mockResolvedValue({ ok: true });
  fetchWithTimeout.mockReset().mockResolvedValue({ ok: true });
});

// ── Barrido de fases zombi (api/pipeline/cleanup.js) ────────────────────────
describe('GET /api/pipeline/cleanup — cuelgue heredado (fase sync zombi)', () => {
  it('cuelgue: tumbar la fase sync por antigüedad también falla song_line_timings en processing', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.sync.status = 'running';

    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([{ id: 'run-1', songId: 'song-1' }]); // candidatos por updated_at
    sqlResponses.push([{ phases, auto_retries: 0 }]); // SELECT ... FOR UPDATE dentro de la tx
    sqlResponses.push([]); // UPDATE song_line_timings (nuevo)
    sqlResponses.push([]); // UPDATE final de phases
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded

    const res = makeRes();
    await cleanupHandler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ timedOut: 1 }));
    const timingsUpdate = capturedInnerQueries.find((q) => q.includes('song_line_timings'));
    expect(timingsUpdate).toBeTruthy();
    expect(timingsUpdate).toMatch(/status = 'failed'/);
    expect(timingsUpdate).toMatch(/status = 'processing'/);
  });

  it('una fase zombi que NO es sync no toca song_line_timings', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'running';

    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([{ id: 'run-2', songId: 'song-2' }]);
    sqlResponses.push([{ phases, auto_retries: 0 }]); // SELECT ... FOR UPDATE
    sqlResponses.push([]); // UPDATE final de phases (sin el de timings)
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded

    const res = makeRes();
    await cleanupHandler(makeReq(), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ timedOut: 1 }));
    expect(capturedInnerQueries.some((q) => q.includes('song_line_timings'))).toBe(false);
  });
});

// ── Guarda de dispatchAlign (api/_lib/align.js) ─────────────────────────────
describe('dispatchAlign — cuelgue heredado (guarda de processing caduca)', () => {
  it("'processing' con updated_at reciente → 409, no postea a Modal", async () => {
    topLevelResponses.push([{ storageKey: 'song-1/full.mp3' }]); // SELECT song_audio
    topLevelResponses.push([{ status: 'processing', updatedAt: new Date().toISOString() }]); // SELECT song_line_timings

    await expect(dispatchAlign('song-1')).rejects.toMatchObject({ status: 409 });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("'processing' con updated_at de hace 31 minutos → procede (fila muerta, cuelgue heredado)", async () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    topLevelResponses.push([{ storageKey: 'song-1/full.mp3' }]); // SELECT song_audio
    topLevelResponses.push([{ status: 'processing', updatedAt: stale }]); // SELECT song_line_timings
    topLevelResponses.push([{ sections: [] }]); // SELECT songs
    topLevelResponses.push([]); // getPipelineLyrics (song_pipeline_lyrics)
    topLevelResponses.push([]); // INSERT ... ON CONFLICT processing

    await dispatchAlign('song-1');

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });
});
