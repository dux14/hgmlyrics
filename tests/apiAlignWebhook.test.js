/**
 * apiAlignWebhook.test.js — TDD para:
 *  - POST /api/align/webhook: callback de Modal con los timings del forced
 *    alignment (contrato { songId, lines, provider } o { songId, error }).
 *  - PUT /api/songs/[id]: marca song_line_timings como 'stale' cuando cambian
 *    las secciones (letra) de la cancion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

// ── sql mock: cola FIFO de respuestas + registro de llamadas ────────────────
const sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
sqlMock.begin = async (cb) => cb(sqlMock);
vi.mock('../api/_lib/db.js', () => ({ default: sqlMock }));

vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin-1' })),
}));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
}));
vi.mock('../src/lib/musicKeys.js', () => ({ isValidKey: () => true }));
vi.mock('../src/lib/voiceSystem.js', () => ({
  validateSongV2: vi.fn(),
  validateSongV3: vi.fn(),
}));

const applyPipelinePhaseEventMock = vi.fn(async () => ({ status: 'running', next: {}, songId: 'song-1' }));
vi.mock('../api/_lib/pipeline/process.js', () => ({
  applyPipelinePhaseEvent: (...args) => applyPipelinePhaseEventMock(...args),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';
process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';
process.env.MODAL_WEBHOOK_SECRET = 'modalwebhooksecret';

const webhookHandler = (await import('../api/align/webhook.js')).default;

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function modalAlignReq(bodyObj) {
  const body = JSON.stringify(bodyObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', 'modalwebhooksecret')
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.headers = { 'x-modal-timestamp': timestamp, 'x-modal-signature': sig };
  req.query = {};
  req.url = '/api/align/webhook';
  return req;
}

beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  applyPipelinePhaseEventMock.mockClear();
});

// Fixture: 3 lineas canonicas (misma proyeccion que api/_lib/align.js).
const SECTIONS_3_LINES = [
  {
    type: 'verse',
    lines: [
      { text: 'Santo, Santo, Santo' },
      { text: '(instrumental)', annotation: true },
      { text: 'Por eso con los angeles, diciendo:' },
    ],
  },
  { type: 'chorus', lines: [{ text: 'Es el Senor' }] },
];

describe('POST /api/align/webhook — firma HMAC', () => {
  it('401 si la firma Modal es invalida', async () => {
    const body = JSON.stringify({ songId: 'song-1', lines: [] });
    const req = Readable.from([Buffer.from(body)]);
    req.method = 'POST';
    req.headers = {
      'x-modal-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-modal-signature': 'deadbeef',
    };
    req.query = {};
    req.url = '/api/align/webhook';
    const res = makeRes();
    await webhookHandler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/align/webhook — validacion de payload', () => {
  it('400 si falta songId', async () => {
    const res = makeRes();
    await webhookHandler(modalAlignReq({ lines: [] }), res);
    expect(res.statusCode).toBe(400);
  });

  it('400 si no hay error y lines no es un array', async () => {
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines: 'nope' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/align/webhook — payload de error', () => {
  it('marca failed con el error persistido', async () => {
    sqlResponses.push([]); // UPDATE ... status='failed'
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', error: 'Modal boom' }), res);
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update).toBeTruthy();
    expect(update.text).toContain('failed');
    expect(update.values.some((v) => String(v).includes('Modal boom'))).toBe(true);
  });
});

describe('POST /api/align/webhook — payload de lines validas', () => {
  it('marca ready y persiste lines/provider, limpia error', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 1200 },
      { i: 2, startMs: 3400 },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update).toBeTruthy();
    expect(update.text).toContain('ready');
    expect(update.text).not.toContain('failed');
    // values: [linesRow, provider, bpm_detected, beats, songId] — shape explicito
    // por linea aunque el payload no traiga score/interpolated (Modal viejo).
    expect(update.values[0]).toEqual([
      { i: 0, startMs: 0, score: null, interpolated: false },
      { i: 1, startMs: 1200, score: null, interpolated: false },
      { i: 2, startMs: 3400, score: null, interpolated: false },
    ]);
  });
});

describe('POST /api/align/webhook — score/interpolated por linea (best-effort)', () => {
  it('score/interpolated validos → persistidos con shape explicito', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [
      { i: 0, startMs: 100, score: 0.87, interpolated: false },
      { i: 1, startMs: 500, score: null, interpolated: true },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.values[0]).toEqual([
      { i: 0, startMs: 100, score: 0.87, interpolated: false },
      { i: 1, startMs: 500, score: null, interpolated: true },
    ]);
  });

  it('sin score/interpolated (Modal viejo) → caen a null/false, no falla', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [{ i: 0, startMs: 100 }];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.values[0]).toEqual([{ i: 0, startMs: 100, score: null, interpolated: false }]);
  });

  it('score fuera de rango o no numerico → cae a null, timing se conserva', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [
      { i: 0, startMs: 100, score: 1.5, interpolated: false },
      { i: 1, startMs: 500, score: -0.2, interpolated: false },
      { i: 2, startMs: 900, score: 'x', interpolated: false },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.values[0]).toEqual([
      { i: 0, startMs: 100, score: null, interpolated: false },
      { i: 1, startMs: 500, score: null, interpolated: false },
      { i: 2, startMs: 900, score: null, interpolated: false },
    ]);
  });

  it('interpolated no booleano → cae a false, timing se conserva', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [
      { i: 0, startMs: 100, score: 0.5, interpolated: 'true' },
      { i: 1, startMs: 500, score: 0.5, interpolated: 1 },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.values[0]).toEqual([
      { i: 0, startMs: 100, score: 0.5, interpolated: false },
      { i: 1, startMs: 500, score: 0.5, interpolated: false },
    ]);
  });
});

describe('POST /api/align/webhook — payload de beats (best-effort)', () => {
  it('beats validos → el UPDATE de exito persiste bpm_detected y beats', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 1200 },
    ];
    const beats = { bpm: 92.5, beatsMs: [0, 650, 1300] };
    const res = makeRes();
    await webhookHandler(
      modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx', beats }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.text).toContain('bpm_detected');
    expect(update.text).toContain('beats');
    expect(update.values).toContain(92.5);
    expect(update.values.some((v) => v && v.bpm === 92.5)).toBe(true);
  });

  it('beats malformados → 200 ready, lines persistidas, bpm_detected/beats NULL, console.warn', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 1200 },
    ];
    const beats = { bpm: 92, beatsMs: [10, 10] }; // no estrictamente creciente
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = makeRes();
    await webhookHandler(
      modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx', beats }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.text).toContain('ready');
    // values: [lines, provider, bpm_detected, beats, songId] — ambos NULL.
    expect(update.values[2]).toBeNull();
    expect(update.values[3]).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('sin campo beats → bpm_detected/beats NULL, sin console.warn', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 1200 },
    ];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.text).toContain('ready');
    // values: [lines, provider, bpm_detected, beats, songId] — ambos NULL.
    expect(update.values[2]).toBeNull();
    expect(update.values[3]).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('POST /api/align/webhook — lines estructuralmente invalidas (200 + failed)', () => {
  it('startMs no monotono creciente → failed, 200', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='failed'
    const lines = [
      { i: 0, startMs: 1000 },
      { i: 1, startMs: 500 },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines }), res);
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.text).toContain('failed');
  });

  it('i fuera de rango (>= canonicalCount) → failed, 200', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='failed'
    const lines = [
      { i: 0, startMs: 0 },
      { i: 99, startMs: 1000 },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines }), res);
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.text).toContain('failed');
  });

  it('i duplicado → failed, 200', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='failed'
    const lines = [
      { i: 0, startMs: 0 },
      { i: 0, startMs: 1000 },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines }), res);
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.text).toContain('failed');
  });

  it('i fuera de orden (no ascendente) → failed, 200', async () => {
    // El front (seekSyncToLine) asume i ascendente en el orden del array; el
    // webhook es la frontera de confianza que valida ese invariante.
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='failed'
    const lines = [
      { i: 2, startMs: 0 },
      { i: 0, startMs: 1000 },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines }), res);
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.text).toContain('failed');
  });

  it('los UPDATE de estado del webhook solo pisan filas en processing', async () => {
    // Guard anti-clobber: un resultado tardio de un job viejo no debe pisar
    // 'stale' (edicion de secciones con job en vuelo) ni un ciclo nuevo.
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE ... status='ready'
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 1000 },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines }), res);
    expect(res.statusCode).toBe(200);
    const update = sqlCalls.find((c) => c.text.startsWith('UPDATE song_line_timings'));
    expect(update.text).toContain("status = 'processing'");
  });
});

describe('POST /api/align/webhook — puente al run unificado (fase sync)', () => {
  it('ready + run activo con sync running → notifica applyPipelinePhaseEvent({phase:sync, ok:true})', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE song_line_timings ... status='ready'
    sqlResponses.push([{ id: 'run-1', phases: { sync: { status: 'running' } } }]); // SELECT run activo
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 1200 },
    ];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    const runSelect = sqlCalls.find((c) => c.text.startsWith('SELECT id, phases FROM song_pipeline_runs'));
    expect(runSelect).toBeTruthy();
    expect(applyPipelinePhaseEventMock).toHaveBeenCalledTimes(1);
    expect(applyPipelinePhaseEventMock.mock.calls[0][1]).toBe('run-1');
    expect(applyPipelinePhaseEventMock.mock.calls[0][2]).toEqual({ phase: 'sync', ok: true, error: undefined });
  });

  it('failed (error de Modal) + run activo con sync running → notifica ok:false', async () => {
    sqlResponses.push([]); // UPDATE song_line_timings ... status='failed'
    sqlResponses.push([{ id: 'run-2', phases: { sync: { status: 'running' } } }]); // SELECT run activo
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', error: 'Modal boom' }), res);
    expect(res.statusCode).toBe(200);
    expect(applyPipelinePhaseEventMock).toHaveBeenCalledTimes(1);
    expect(applyPipelinePhaseEventMock.mock.calls[0][2]).toEqual({
      phase: 'sync',
      ok: false,
      error: 'Modal boom',
    });
  });

  it('ready SIN run activo → NO toca song_pipeline_runs (flujo legacy intacto)', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE song_line_timings ... status='ready'
    sqlResponses.push([]); // SELECT run activo → sin filas
    const lines = [{ i: 0, startMs: 0 }];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    expect(applyPipelinePhaseEventMock).not.toHaveBeenCalled();
  });

  it('ready + snapshotHash en el payload de Modal → se reenvía tal cual al phase-event', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE song_line_timings ... status='ready'
    sqlResponses.push([{ id: 'run-4', phases: { sync: { status: 'running' } } }]); // SELECT run activo
    const lines = [{ i: 0, startMs: 0 }];
    const res = makeRes();
    await webhookHandler(
      modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx', snapshotHash: 'hash123' }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(applyPipelinePhaseEventMock.mock.calls[0][2]).toEqual({
      phase: 'sync',
      ok: true,
      error: undefined,
      snapshotHash: 'hash123',
    });
  });

  it('error con snapshotHash en el payload de Modal → se reenvía al phase-event de sync', async () => {
    sqlResponses.push([]); // UPDATE song_line_timings ... status='failed'
    sqlResponses.push([{ id: 'run-5', phases: { sync: { status: 'running' } } }]); // SELECT run activo
    const res = makeRes();
    await webhookHandler(
      modalAlignReq({ songId: 'song-1', error: 'Modal boom', snapshotHash: 'hash456' }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(applyPipelinePhaseEventMock.mock.calls[0][2]).toEqual({
      phase: 'sync',
      ok: false,
      error: 'Modal boom',
      snapshotHash: 'hash456',
    });
  });

  it('ready SIN snapshotHash (karaoke) → phase-event sigue funcionando sin el campo', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE song_line_timings ... status='ready'
    sqlResponses.push([{ id: 'run-6', phases: { sync: { status: 'running' } } }]); // SELECT run activo
    const lines = [{ i: 0, startMs: 0 }];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    expect(applyPipelinePhaseEventMock).toHaveBeenCalledTimes(1);
    expect(applyPipelinePhaseEventMock.mock.calls[0][2].snapshotHash).toBeUndefined();
  });

  it('ready con run activo pero sync NO running → NO notifica (fase ya terminal o distinta)', async () => {
    sqlResponses.push([{ sections: SECTIONS_3_LINES }]); // SELECT sections
    sqlResponses.push([]); // UPDATE song_line_timings ... status='ready'
    sqlResponses.push([{ id: 'run-3', phases: { sync: { status: 'done' } } }]); // SELECT run activo
    const lines = [{ i: 0, startMs: 0 }];
    const res = makeRes();
    await webhookHandler(modalAlignReq({ songId: 'song-1', lines, provider: 'whisperx' }), res);
    expect(res.statusCode).toBe(200);
    expect(applyPipelinePhaseEventMock).not.toHaveBeenCalled();
  });
});

// ── PUT /api/songs/[id] — marca stale al cambiar secciones ─────────────────
describe('PUT /api/songs/[id] — song_line_timings stale al editar secciones', () => {
  const updateHandler = async (...args) => {
    const mod = await import('../api/songs/[id].js');
    return mod.default(...args);
  };

  function makeReq(body) {
    return { method: 'PUT', query: { id: 'song-1' }, body };
  }

  it('sections cambiadas → emite UPDATE song_line_timings SET status=stale', async () => {
    sqlResponses.push([{ sections: [{ type: 'verse', lines: [{ text: 'viejo' }] }] }]); // SELECT prevRow
    sqlResponses.push({ count: 1 }); // UPDATE songs (dentro de sql.begin -> sqlMock)
    sqlResponses.push([]); // UPDATE song_line_timings stale
    const req = makeReq({ title: 'X', sections: [{ type: 'verse', lines: [{ text: 'nuevo' }] }] });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res.statusCode).toBe(200);
    const stale = sqlCalls.find(
      (c) => c.text.startsWith('UPDATE song_line_timings') && c.text.includes('stale'),
    );
    expect(stale).toBeTruthy();
  });

  it('sections iguales (solo cambia el titulo) → NO emite UPDATE stale', async () => {
    const sections = [{ type: 'verse', lines: [{ text: 'igual' }] }];
    sqlResponses.push([{ sections }]); // SELECT prevRow
    sqlResponses.push({ count: 1 }); // UPDATE songs
    const req = makeReq({ title: 'Nuevo titulo', sections });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res.statusCode).toBe(200);
    const stale = sqlCalls.find(
      (c) => c.text.startsWith('UPDATE song_line_timings') && c.text.includes('stale'),
    );
    expect(stale).toBeUndefined();
  });

  it('mismas lineas pero claves en orden distinto (roundtrip JSONB) → NO emite UPDATE stale', async () => {
    // prevRow simula lo leido de Postgres: JSONB reordena las claves internas.
    const prevSections = [
      {
        type: 'verse',
        lines: [{ groups: [], chords: [], text: 'igual', annotation: false, spoken: false }],
      },
    ];
    // Sections del front: mismo contenido, orden literal de claves distinto.
    const newSections = [
      {
        type: 'verse',
        lines: [{ text: 'igual', groups: [], chords: [], annotation: false, spoken: false }],
      },
    ];
    sqlResponses.push([{ sections: prevSections }]); // SELECT prevRow
    sqlResponses.push({ count: 1 }); // UPDATE songs
    const req = makeReq({ title: 'X', sections: newSections });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res.statusCode).toBe(200);
    const stale = sqlCalls.find(
      (c) => c.text.startsWith('UPDATE song_line_timings') && c.text.includes('stale'),
    );
    expect(stale).toBeUndefined();
  });

  it('cambian solo los acordes de una linea (mismo text/annotation/spoken) → NO emite UPDATE stale', async () => {
    const prevSections = [
      {
        type: 'verse',
        lines: [{ text: 'igual', groups: [], chords: ['C', 'G'], annotation: false }],
      },
    ];
    const newSections = [
      {
        type: 'verse',
        lines: [{ text: 'igual', groups: [], chords: ['D', 'Am'], annotation: false }],
      },
    ];
    sqlResponses.push([{ sections: prevSections }]); // SELECT prevRow
    sqlResponses.push({ count: 1 }); // UPDATE songs
    const req = makeReq({ title: 'X', sections: newSections });
    const res = makeRes();
    await updateHandler(req, res);
    expect(res.statusCode).toBe(200);
    const stale = sqlCalls.find(
      (c) => c.text.startsWith('UPDATE song_line_timings') && c.text.includes('stale'),
    );
    expect(stale).toBeUndefined();
  });
});
