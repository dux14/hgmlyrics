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
const mockDeleteSongAudioPrefix = vi.fn();
vi.mock('../api/_lib/storage.js', () => ({
  deleteSongAudioObject: mockDeleteSongAudioObject,
  deleteSongAudioPrefix: mockDeleteSongAudioPrefix,
}));

// ── Mock de retryPhase (Tarea 5): el cron NO despacha directo, delega en el
// mismo núcleo que el retry manual. Se mockea porque retryPhase hace su propio
// sql.begin + un POST de red (dispatchPhase) que no corresponde ejercitar acá.
const mockRetryPhase = vi.fn();
vi.mock('../api/_lib/pipeline/retryPhase.js', () => ({ retryPhase: mockRetryPhase }));

// ── Mock de sql ────────────────────────────────────────────────────────────────
// sql principal saca de topLevelResponses; sql.begin(cb) corre cb con un sql
// interno que saca de sqlResponses (mismo patron que pipelineWebhook.test.js).
// Ambos arrays de queries capturadas (texto crudo) sirven para distinguir un
// UPDATE con next_retry_at agendado de uno sin agendar (misma forma de
// respuesta, distinto SQL).
const topLevelResponses = [];
const sqlResponses = [];
const capturedTopLevelQueries = [];
const capturedInnerQueries = [];
function makeInnerSql() {
  const inner = (strings, ...values) => {
    if (!strings?.raw) return strings;
    capturedInnerQueries.push(strings.raw.join('?'));
    return Promise.resolve(sqlResponses.shift() ?? []);
  };
  inner.json = (v) => v;
  return inner;
}
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  capturedTopLevelQueries.push(strings.raw.join('?'));
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
  capturedTopLevelQueries.length = 0;
  capturedInnerQueries.length = 0;
  mockDeleteSongAudioObject.mockReset().mockResolvedValue(undefined);
  mockDeleteSongAudioPrefix.mockReset().mockResolvedValue(undefined);
  mockRetryPhase.mockReset().mockResolvedValue({ ok: true });
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
    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([]); // candidatos de fases running
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded
    topLevelResponses.push([]); // SELECT runs cancelled

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      autoRetried: 0,
      timedOut: 0,
      abandoned: 0,
      supersededCleaned: 0,
      cancelledCleaned: 0,
    });
  });
});

describe('GET /api/pipeline/cleanup — reintentos automáticos diferidos (next_retry_at vencido)', () => {
  it('fase failed transitoria dentro de presupuesto → dispara retryPhase(auto:true)', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'failed';
    phases.stems.error = 'Modal 503: servicio no disponible';

    topLevelResponses.push([{ id: 'run-9', songId: 'song-9', phases, autoRetries: 0 }]); // dueRuns
    topLevelResponses.push([]); // candidatos fases running
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded
    topLevelResponses.push([]); // SELECT runs cancelled

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockRetryPhase).toHaveBeenCalledWith(expect.anything(), {
      songId: 'song-9',
      phase: 'stems',
      auto: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ autoRetried: 1 }));
  });

  it('fase failed permanente (OOM) → no dispara retryPhase y limpia next_retry_at', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'failed';
    phases.stems.error = 'CUDA out of memory';

    topLevelResponses.push([{ id: 'run-10', songId: 'song-10', phases, autoRetries: 0 }]); // dueRuns
    topLevelResponses.push([]); // UPDATE next_retry_at = NULL (ninguna fase calificó)
    topLevelResponses.push([]); // candidatos fases running
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded
    topLevelResponses.push([]); // SELECT runs cancelled

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockRetryPhase).not.toHaveBeenCalled();
    expect(
      capturedTopLevelQueries.some((q) => q.includes('next_retry_at') && q.includes('NULL')),
    ).toBe(true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ autoRetried: 0 }));
  });
});

describe('GET /api/pipeline/cleanup — fase zombi (running > 30 min)', () => {
  it('marca failed la fase running y recalcula status del run', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'running';

    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([{ id: 'run-1' }]); // candidatos por updated_at
    sqlResponses.push([{ phases, auto_retries: 0 }]); // SELECT ... FOR UPDATE dentro de la tx
    sqlResponses.push([]); // UPDATE final
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ timedOut: 1 }));
    // La fase failed (error transitorio) pasa shouldAutoRetry → se agenda
    // next_retry_at en el MISMO UPDATE, nunca inmediato (job colgado 30 min).
    expect(
      capturedInnerQueries.some(
        (q) => q.includes('next_retry_at') && q.includes("interval '10 minutes'"),
      ),
    ).toBe(true);
  });

  it('CAS: si la fase ya no está running dentro de la tx (webhook la completó), no la toca', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'done'; // ya no está running al releer dentro de la tx

    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([{ id: 'run-1' }]);
    sqlResponses.push([{ phases, auto_retries: 0 }]); // SELECT ... FOR UPDATE: fase ya terminal
    topLevelResponses.push([]);
    topLevelResponses.push([]);

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ timedOut: 0 }));
  });
});

describe('GET /api/pipeline/cleanup — runs abandonados (created/uploading > 24h)', () => {
  it('borra el run y su storage de input', async () => {
    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([]); // candidatos fases running
    topLevelResponses.push([{ id: 'run-2', input_path: 'song-1/runs/run-2/full.mp3' }]); // DELETE runs abandonados RETURNING
    topLevelResponses.push([]); // SELECT runs superseded

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockDeleteSongAudioObject).toHaveBeenCalledWith('song-1/runs/run-2/full.mp3');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ abandoned: 1 }));
  });

  it('no intenta borrar storage si input_path es null', async () => {
    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([]);
    topLevelResponses.push([{ id: 'run-3', input_path: null }]);
    topLevelResponses.push([]);

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockDeleteSongAudioObject).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ abandoned: 1 }));
  });
});

describe('GET /api/pipeline/cleanup — runs superseded', () => {
  it('borra el storage de input de un run superseded', async () => {
    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([]); // candidatos fases running
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([{ id: 'run-4', input_path: 'song-1/runs/run-4/full.mp3' }]); // SELECT runs superseded
    topLevelResponses.push([]); // UPDATE input_path = NULL

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockDeleteSongAudioObject).toHaveBeenCalledWith('song-1/runs/run-4/full.mp3');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ supersededCleaned: 1 }));
  });

  it('un borrado de storage que falla no marca el run como limpio (se reintenta después)', async () => {
    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
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
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ supersededCleaned: 1 }));
  });
});

describe('GET /api/pipeline/cleanup — runs cancelled (#4: objetos huérfanos de purgeRun)', () => {
  it('barre <songId>/stems|clips/ y el input del run, luego limpia input_path', async () => {
    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([]); // candidatos fases running
    topLevelResponses.push([]); // DELETE runs abandonados
    topLevelResponses.push([]); // SELECT runs superseded
    topLevelResponses.push([
      { id: 'run-7', song_id: 'song-1', input_path: 'song-1/runs/run-7/full.mp3' },
    ]); // SELECT runs cancelled
    topLevelResponses.push([]); // UPDATE input_path = NULL

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(mockDeleteSongAudioPrefix).toHaveBeenCalledWith('song-1');
    expect(mockDeleteSongAudioObject).toHaveBeenCalledWith('song-1/runs/run-7/full.mp3');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cancelledCleaned: 1 }));
  });

  it('un sweep que falla no marca el run cancelado como limpio (se reintenta después)', async () => {
    topLevelResponses.push([]); // reintentos diferidos (dueRuns)
    topLevelResponses.push([]);
    topLevelResponses.push([]);
    topLevelResponses.push([]);
    topLevelResponses.push([
      { id: 'run-8', song_id: 'song-2', input_path: 'song-2/runs/run-8/full.mp3' },
    ]);

    mockDeleteSongAudioPrefix.mockReset().mockRejectedValue(new Error('storage caído'));

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cancelledCleaned: 0 }));
  });
});
