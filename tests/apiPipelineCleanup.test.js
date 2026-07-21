/**
 * apiPipelineCleanup.test.js — TDD para GET /api/pipeline/cleanup (cron job).
 * Mismo patrón de mocks que tests/pipelineWebhook.test.js (sql.begin con sql
 * interno que va sacando de sqlResponses) + tests/apiStemsCleanup.test.js
 * (auth fail-closed, Promise.allSettled).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRes } from './helpers/makeRes.js';
import { initialPhases } from '../api/_lib/pipeline/state.js';

// ── Mock de storage ───────────────────────────────────────────────────────────
const mockDeleteSongAudioObject = vi.fn();
vi.mock('../api/_lib/storage.js', () => ({
  deleteSongAudioObject: mockDeleteSongAudioObject,
}));

// ── Mock de sql ────────────────────────────────────────────────────────────────
// sql principal saca de topLevelResponses; sql.begin(cb) corre cb con un sql
// interno que saca de sqlResponses (mismo patron que pipelineWebhook.test.js).
const topLevelResponses = [];
const sqlResponses = [];
function makeInnerSql() {
  const inner = (strings, ...values) => {
    if (!strings?.raw) return strings;
    return Promise.resolve(sqlResponses.shift() ?? []);
  };
  inner.json = (v) => v;
  return inner;
}
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  return Promise.resolve(topLevelResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
sqlMock.begin = async (cb) => cb(makeInnerSql());
vi.mock('postgres', () => ({ default: () => sqlMock }));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/pipeline/cleanup.js')).default;

function makeReq(over = {}) {
  return { method: 'GET', headers: {}, query: {}, body: {}, ...over };
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  topLevelResponses.length = 0;
  sqlResponses.length = 0;
  mockDeleteSongAudioObject.mockReset().mockResolvedValue(undefined);
  process.env.CRON_SECRET = 'supersecret';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  }
});

describe('GET /api/pipeline/cleanup — auth fail-closed', () => {
  it('SEC-02: CRON_SECRET ausente + header "Bearer undefined" → 401 y no ejecuta nada', async () => {
    delete process.env.CRON_SECRET;
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer undefined' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockDeleteSongAudioObject).not.toHaveBeenCalled();
  });

  it('CRON_SECRET definido + header equivocado → 401', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer wrong' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockDeleteSongAudioObject).not.toHaveBeenCalled();
  });

  it('header correcto pero sin candidatos → 200 con conteos en cero', async () => {
    topLevelResponses.push([]); // candidatos de fases running
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ timedOut: 0, abandoned: 0, supersededCleaned: 0 });
  });
});

describe('GET /api/pipeline/cleanup — fase zombi (running > 30 min)', () => {
  it('marca failed la fase running y recalcula status del run', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'running';

    topLevelResponses.push([{ id: 'run-1' }]); // candidatos por updated_at
    sqlResponses.push([{ phases }]); // SELECT ... FOR UPDATE dentro de la tx
    sqlResponses.push([]); // UPDATE final
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ timedOut: 1 }),
    );
  });

  it('CAS: si la fase ya no está running dentro de la tx (webhook la completó), no la toca', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'done'; // ya no está running al releer dentro de la tx

    topLevelResponses.push([{ id: 'run-1' }]);
    sqlResponses.push([{ phases }]); // SELECT ... FOR UPDATE: fase ya terminal
    topLevelResponses.push([]);
    topLevelResponses.push([]);

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ timedOut: 0 }),
    );
  });
});

describe('GET /api/pipeline/cleanup — runs abandonados (created/uploading > 24h)', () => {
  it('borra el run y su storage de input', async () => {
    topLevelResponses.push([]); // candidatos fases running
    topLevelResponses.push([
      { id: 'run-2', input_path: 'song-1/runs/run-2/full.mp3' },
    ]); // DELETE runs abandonados RETURNING
    topLevelResponses.push([]); // SELECT runs superseded

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockDeleteSongAudioObject).toHaveBeenCalledWith('song-1/runs/run-2/full.mp3');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ abandoned: 1 }),
    );
  });

  it('no intenta borrar storage si input_path es null', async () => {
    topLevelResponses.push([]);
    topLevelResponses.push([{ id: 'run-3', input_path: null }]);
    topLevelResponses.push([]);

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockDeleteSongAudioObject).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ abandoned: 1 }),
    );
  });
});

describe('GET /api/pipeline/cleanup — runs superseded', () => {
  it('borra el storage de input de un run superseded', async () => {
    topLevelResponses.push([]); // candidatos fases running
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([
      { id: 'run-4', input_path: 'song-1/runs/run-4/full.mp3' },
    ]); // SELECT runs superseded
    topLevelResponses.push([]); // UPDATE input_path = NULL

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockDeleteSongAudioObject).toHaveBeenCalledWith('song-1/runs/run-4/full.mp3');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ supersededCleaned: 1 }),
    );
  });

  it('un borrado de storage que falla no marca el run como limpio (se reintenta después)', async () => {
    topLevelResponses.push([]);
    topLevelResponses.push([]);
    topLevelResponses.push([
      { id: 'run-5', input_path: 'song-1/runs/run-5/full.mp3' },
      { id: 'run-6', input_path: 'song-1/runs/run-6/full.mp3' },
    ]);
    topLevelResponses.push([]); // UPDATE input_path = NULL para run-6 (unico exitoso)

    mockDeleteSongAudioObject
      .mockReset()
      .mockRejectedValueOnce(new Error('storage caído'))
      .mockResolvedValue(undefined);

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockDeleteSongAudioObject).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ supersededCleaned: 1 }),
    );
  });
});
