/**
 * apiSongAudio.test.js — TDD para /api/songs/[id]/audio (mp3 completo por
 * cancion). GET (estado audio+timings), POST (upsert+URL firmada de subida,
 * confirm dispara alignment), DELETE (borra objeto+fila+timings).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

// sql mock: cola de respuestas (FIFO) + registro de llamadas para inspeccionar el SQL emitido.
let sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('../api/_lib/db.js', () => ({ default: sqlMock }));

vi.mock('../api/_lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ id: 'user-1' })),
  requireAdmin: vi.fn(async () => ({ id: 'admin-1' })),
}));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
}));
vi.mock('../api/_lib/storage.js', () => ({
  createSongAudioSignedPutUrl: vi.fn((key) => Promise.resolve(`https://put/${key}`)),
  signSongAudioDownload: vi.fn((key) => Promise.resolve(`https://get/${key}`)),
  deleteSongAudioObject: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/align.js', () => ({
  dispatchAlign: vi.fn(async () => {}),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/songs/[id]/audio.js')).default;
const { requireUser, requireAdmin } = await import('../api/_lib/auth.js');
const { allowMethods } = await import('../api/_lib/http.js');
const { createSongAudioSignedPutUrl, deleteSongAudioObject } =
  await import('../api/_lib/storage.js');
const { dispatchAlign } = await import('../api/_lib/align.js');

function makeReq(over = {}) {
  return { method: 'GET', query: { id: 'song-1' }, body: {}, ...over };
}

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (s) => {
    res._status = s;
    return res;
  };
  res.json = (b) => {
    res._body = b;
    return res;
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlResponses = [];
  sqlCalls.length = 0;
});

describe('GET /api/songs/[id]/audio', () => {
  it('sin fila → 200 { audio: null, timings: null }', async () => {
    sqlResponses.push([]); // SELECT song_audio
    const res = makeRes();
    await handler(makeReq(), res);
    expect(requireUser).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ audio: null, timings: null });
  });

  it('con fila → 200 { audio: { url, durationSec }, timings: { status, lines } }', async () => {
    // Filas fieles al SELECT real: las columnas bpm/beats SIEMPRE vienen (null
    // si no hay valor) y el GET las normaliza a null explícito.
    sqlResponses.push([
      {
        storageKey: 'song-1/full.mp3',
        durationSec: 210,
        bpmManual: null,
        timeSignature: null,
        beatAnchor: null,
      },
    ]); // SELECT song_audio
    sqlResponses.push([
      { status: 'ready', lines: [{ i: 0, startMs: 100 }], bpmDetected: null, beats: null },
    ]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      audio: {
        url: 'https://get/song-1/full.mp3',
        durationSec: 210,
        bpmManual: null,
        timeSignature: null,
        beatAnchor: null,
      },
      timings: {
        status: 'ready',
        // Línea vieja (persistida antes de la Task 5.2/2) sin score/interpolated/manual
        // en el JSONB → el GET los rellena con los defaults.
        lines: [{ i: 0, startMs: 100, score: null, interpolated: false, manual: false }],
        bpmDetected: null,
        beats: null,
      },
    });
  });

  it('lines con score/interpolated propios (Task 5.2) → la respuesta los expone tal cual', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3', durationSec: 210 }]); // SELECT song_audio
    sqlResponses.push([
      {
        status: 'ready',
        lines: [
          { i: 0, startMs: 100, score: 0.92, interpolated: false },
          { i: 1, startMs: 2400, score: null, interpolated: true },
        ],
        bpmDetected: null,
        beats: null,
      },
    ]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.timings.lines).toEqual([
      { i: 0, startMs: 100, score: 0.92, interpolated: false, manual: false },
      { i: 1, startMs: 2400, score: null, interpolated: true, manual: false },
    ]);
  });

  it('lines viejas sin score/interpolated (persistidas antes de Task 5.2) → se rellenan con defaults', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3', durationSec: 210 }]); // SELECT song_audio
    sqlResponses.push([
      {
        status: 'ready',
        lines: [
          { i: 0, startMs: 0 },
          { i: 1, startMs: 500 },
        ],
        bpmDetected: null,
        beats: null,
      },
    ]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.timings.lines).toEqual([
      { i: 0, startMs: 0, score: null, interpolated: false, manual: false },
      { i: 1, startMs: 500, score: null, interpolated: false, manual: false },
    ]);
  });

  it('con fila + overrides/beats → expone bpmManual/timeSignature/beatAnchor y bpmDetected + beats APLANADO a beatsMs', async () => {
    sqlResponses.push([
      {
        storageKey: 'song-1/full.mp3',
        durationSec: 210,
        bpmManual: 128,
        timeSignature: '3/4',
        beatAnchor: 2,
      },
    ]); // SELECT song_audio
    sqlResponses.push([
      {
        status: 'ready',
        lines: [{ i: 0, startMs: 100 }],
        bpmDetected: 126.4,
        beats: { bpm: 126.4, beatsMs: [0, 476, 952] },
      },
    ]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      audio: {
        url: 'https://get/song-1/full.mp3',
        durationSec: 210,
        bpmManual: 128,
        timeSignature: '3/4',
        beatAnchor: 2,
      },
      timings: {
        status: 'ready',
        lines: [{ i: 0, startMs: 100, score: null, interpolated: false, manual: false }],
        bpmDetected: 126.4,
        // El JSONB guarda { bpm, beatsMs }; el contrato del GET es la rejilla
        // plana en ms (lo que consume setupMetronome en ImmersiveView).
        beats: [0, 476, 952],
      },
    });
  });

  it('bpmDetected/bpmManual llegan como string del driver pg (NUMERIC) → el GET los devuelve como number', async () => {
    sqlResponses.push([
      {
        storageKey: 'song-1/full.mp3',
        durationSec: 210,
        bpmManual: '128.5',
        timeSignature: '4/4',
        beatAnchor: 1,
      },
    ]); // SELECT song_audio
    sqlResponses.push([
      {
        status: 'ready',
        lines: [{ i: 0, startMs: 100 }],
        bpmDetected: '112.35',
        beats: { bpm: 112.35, beatsMs: [92, 626, 1160] },
      },
    ]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    // Number.isFinite (SongAudioSection.js) NO coacciona strings: "112.35"
    // se rendería como "sin detección". El contrato del GET es number.
    expect(res._body.audio.bpmManual).toBe(128.5);
    expect(res._body.timings.bpmDetected).toBe(112.35);
  });

  it('bpmDetected/bpmManual null en DB → siguen null (no NaN ni 0)', async () => {
    sqlResponses.push([
      {
        storageKey: 'song-1/full.mp3',
        durationSec: 210,
        bpmManual: null,
        timeSignature: null,
        beatAnchor: null,
      },
    ]); // SELECT song_audio
    sqlResponses.push([{ status: 'ready', lines: [], bpmDetected: null, beats: null }]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.audio.bpmManual).toBeNull();
    expect(res._body.timings.bpmDetected).toBeNull();
  });

  it('beats JSONB con shape inesperado (sin beatsMs array) → beats: null, no lanza', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3', durationSec: 210 }]); // SELECT song_audio
    sqlResponses.push([
      { status: 'ready', lines: [], bpmDetected: 90, beats: { bpm: 90, beatsMs: 'corrupto' } },
    ]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.timings.beats).toBeNull();
  });

  it('lines con manual (Task 2) → expone manual:true; lineas viejas sin manual → default false', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3', durationSec: 210 }]); // SELECT song_audio
    sqlResponses.push([
      {
        status: 'ready',
        lines: [
          { i: 0, startMs: 5, manual: true },
          { i: 1, startMs: 9 },
        ],
        bpmDetected: null,
        beats: null,
      },
    ]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.timings.lines).toEqual([
      { i: 0, startMs: 5, score: null, interpolated: false, manual: true },
      { i: 1, startMs: 9, score: null, interpolated: false, manual: false },
    ]);
  });
});

describe('POST /api/songs/[id]/audio', () => {
  function postReq(body) {
    return makeReq({ method: 'POST', body });
  }

  it('no-admin → 403 (requireAdmin lanza)', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res = makeRes();
    await expect(handler(postReq({}), res)).rejects.toThrow('Forbidden');
  });

  it('canción inexistente → 404', async () => {
    sqlResponses.push([]); // SELECT songs no encuentra fila
    const res = makeRes();
    await handler(postReq({}), res);
    expect(res._status).toBe(404);
  });

  it('válido → 200 { uploadUrl, key } y upsert en song_audio', async () => {
    sqlResponses.push([{ id: 'song-1' }]); // SELECT songs
    sqlResponses.push([]); // INSERT ... ON CONFLICT upsert song_audio
    const res = makeRes();
    await handler(postReq({}), res);
    expect(res._status).toBe(200);
    expect(res._body.key).toBe('song-1/full.mp3');
    expect(res._body.uploadUrl).toBe('https://put/song-1/full.mp3');
    expect(createSongAudioSignedPutUrl).toHaveBeenCalledWith('song-1/full.mp3');
    const upsertCall = sqlCalls.find((c) => c.text.includes('INSERT INTO song_audio'));
    expect(upsertCall.text).toContain('ON CONFLICT');
    expect(dispatchAlign).not.toHaveBeenCalled();
  });

  it('{ confirm: true } marca duration_sec, resetea timings a pending y dispara alignment', async () => {
    sqlResponses.push([{ id: 'song-1' }]); // SELECT songs
    sqlResponses.push({ count: 1 }); // UPDATE song_audio SET duration_sec
    sqlResponses.push([]); // UPSERT song_line_timings status='pending'
    const res = makeRes();
    await handler(postReq({ confirm: true, durationSec: 210 }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true });
    const updateCall = sqlCalls.find((c) => c.text.includes('UPDATE song_audio'));
    expect(updateCall).toBeTruthy();
    const timingsCall = sqlCalls.find((c) => c.text.includes('song_line_timings'));
    expect(timingsCall.text).toContain('pending');
    expect(timingsCall.text).toContain('bpm_detected = NULL');
    expect(timingsCall.text).toContain('beats = NULL');
    expect(dispatchAlign).toHaveBeenCalledTimes(1);
    expect(dispatchAlign).toHaveBeenCalledWith('song-1');
  });

  it('{ confirm: true } sin fila song_audio (confirm fuera de orden o DELETE concurrente) → 404, no toca timings ni dispatchAlign', async () => {
    sqlResponses.push([{ id: 'song-1' }]); // SELECT songs
    sqlResponses.push({ count: 0 }); // UPDATE song_audio afecta 0 filas
    const res = makeRes();
    await handler(postReq({ confirm: true, durationSec: 210 }), res);
    expect(res._status).toBe(404);
    const timingsCall = sqlCalls.find((c) => c.text.includes('song_line_timings'));
    expect(timingsCall).toBeUndefined();
    expect(dispatchAlign).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/songs/[id]/audio', () => {
  function patchReq(body) {
    return makeReq({ method: 'PATCH', body });
  }

  it('no-admin → requireAdmin lanza', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res = makeRes();
    await expect(handler(patchReq({ bpmManual: 120 }), res)).rejects.toThrow('Forbidden');
  });

  it('válido parcial (solo bpmManual) → UPDATE de song_audio SOLO con bpm_manual en el SET → 200', async () => {
    sqlResponses.push({ count: 1 }); // UPDATE song_audio
    const res = makeRes();
    await handler(patchReq({ bpmManual: 140 }), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true });
    const updateCall = sqlCalls.find((c) => c.text.includes('UPDATE song_audio'));
    expect(updateCall).toBeTruthy();
    expect(updateCall.values).toEqual([{ bpm_manual: 140 }, 'song-1']);
  });

  it('con null → limpia el override (SET con null)', async () => {
    sqlResponses.push({ count: 1 }); // UPDATE song_audio
    const res = makeRes();
    await handler(patchReq({ bpmManual: null }), res);
    expect(res._status).toBe(200);
    const updateCall = sqlCalls.find((c) => c.text.includes('UPDATE song_audio'));
    expect(updateCall.values).toEqual([{ bpm_manual: null }, 'song-1']);
  });

  it('inválido (bpmManual 10) → 400 con error que contenga "bpmManual" y ningún UPDATE emitido', async () => {
    const res = makeRes();
    await handler(patchReq({ bpmManual: 10 }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/bpmManual/);
    expect(sqlCalls.length).toBe(0);
  });

  it('a canción sin audio (UPDATE count 0) → 404', async () => {
    sqlResponses.push({ count: 0 }); // UPDATE song_audio afecta 0 filas
    const res = makeRes();
    await handler(patchReq({ bpmManual: 140 }), res);
    expect(res._status).toBe(404);
  });

  describe('lineTiming (Task 2 — offset manual por linea)', () => {
    const baseLines = [
      { i: 0, startMs: 1000, score: 0.9, interpolated: false },
      { i: 1, startMs: 4000, score: null, interpolated: true },
      { i: 2, startMs: 9000, score: 0.8, interpolated: false },
    ];

    it('valido → 200; el UPDATE recibe lines con la linea editada shape explicito + manual:true, resto sin manual', async () => {
      sqlResponses.push([{ status: 'ready', lines: baseLines }]); // SELECT song_line_timings
      sqlResponses.push({ count: 1 }); // UPDATE song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 1, startMs: 5000 } }), res);
      expect(res._status).toBe(200);
      expect(res._body).toEqual({ success: true });
      const updateCall = sqlCalls.find((c) => c.text.includes('UPDATE song_line_timings'));
      expect(updateCall).toBeTruthy();
      expect(updateCall.values[0]).toEqual([
        { i: 0, startMs: 1000, score: 0.9, interpolated: false },
        { i: 1, startMs: 5000, score: null, interpolated: true, manual: true },
        { i: 2, startMs: 9000, score: 0.8, interpolated: false },
      ]);
    });

    it('startMs igual al de la linea anterior → 400 "monotonia" con la anterior', async () => {
      sqlResponses.push([{ status: 'ready', lines: baseLines }]); // SELECT song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 1, startMs: 1000 } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/monoton/i);
    });

    it('startMs igual al de la linea siguiente → 400 "monotonia" con la siguiente', async () => {
      sqlResponses.push([{ status: 'ready', lines: baseLines }]); // SELECT song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 1, startMs: 9000 } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/monoton/i);
    });

    it('primera linea (sin anterior) acepta startMs 0', async () => {
      sqlResponses.push([{ status: 'ready', lines: baseLines }]); // SELECT song_line_timings
      sqlResponses.push({ count: 1 }); // UPDATE song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 0, startMs: 0 } }), res);
      expect(res._status).toBe(200);
    });

    it('ultima linea (sin siguiente) acepta un startMs mayor que la anterior sin techo', async () => {
      sqlResponses.push([{ status: 'ready', lines: baseLines }]); // SELECT song_line_timings
      sqlResponses.push({ count: 1 }); // UPDATE song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 2, startMs: 999999 } }), res);
      expect(res._status).toBe(200);
    });

    it('i inexistente en lines → 400', async () => {
      sqlResponses.push([{ status: 'ready', lines: baseLines }]); // SELECT song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 99, startMs: 5000 } }), res);
      expect(res._status).toBe(400);
    });

    it('shape invalido ({i:"x"}) → 400 con el mensaje de validateLineTimingShape, sin llegar a SELECT', async () => {
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 'x' } }), res);
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/lineTiming/);
      expect(sqlCalls.length).toBe(0);
    });

    it('fila ausente en song_line_timings → 404', async () => {
      sqlResponses.push([]); // SELECT song_line_timings sin filas
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 0, startMs: 500 } }), res);
      expect(res._status).toBe(404);
    });

    it('status distinto de ready (job en vuelo) → 409', async () => {
      sqlResponses.push([{ status: 'processing', lines: baseLines }]); // SELECT song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 0, startMs: 500 } }), res);
      expect(res._status).toBe(409);
    });

    it('UPDATE afecta 0 filas (carrera: status cambio entre SELECT y UPDATE) → 409', async () => {
      sqlResponses.push([{ status: 'ready', lines: baseLines }]); // SELECT song_line_timings
      sqlResponses.push({ count: 0 }); // UPDATE song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 0, startMs: 500 } }), res);
      expect(res._status).toBe(409);
    });

    it('lineTiming junto a bpmManual en el mismo body → rama excluyente: se procesa SOLO lineTiming', async () => {
      sqlResponses.push([{ status: 'ready', lines: baseLines }]); // SELECT song_line_timings
      sqlResponses.push({ count: 1 }); // UPDATE song_line_timings
      const res = makeRes();
      await handler(patchReq({ lineTiming: { i: 0, startMs: 500 }, bpmManual: 140 }), res);
      expect(res._status).toBe(200);
      // Ningun UPDATE de song_audio se emitio: solo el de song_line_timings.
      expect(sqlCalls.some((c) => c.text.includes('UPDATE song_audio'))).toBe(false);
      expect(sqlCalls.some((c) => c.text.includes('UPDATE song_line_timings'))).toBe(true);
    });
  });
});

describe('DELETE /api/songs/[id]/audio', () => {
  function deleteReq(body) {
    return makeReq({ method: 'DELETE', body });
  }

  it('admin → borra objeto + fila + timings; 200 { success: true }', async () => {
    sqlResponses.push([{ storageKey: 'song-1/full.mp3' }]); // SELECT song_audio
    sqlResponses.push([]); // DELETE song_audio
    sqlResponses.push([]); // DELETE song_line_timings
    const res = makeRes();
    await handler(deleteReq({}), res);
    expect(requireAdmin).toHaveBeenCalled();
    expect(deleteSongAudioObject).toHaveBeenCalledWith('song-1/full.mp3');
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true });
  });

  it('canción sin audio → 404', async () => {
    sqlResponses.push([]); // SELECT song_audio no encuentra fila
    const res = makeRes();
    await handler(deleteReq({}), res);
    expect(res._status).toBe(404);
    expect(deleteSongAudioObject).not.toHaveBeenCalled();
  });
});

describe('router', () => {
  it('allowMethods incluye PATCH junto a GET/POST/DELETE', async () => {
    sqlResponses.push([]); // SELECT song_audio (GET pasa de largo, allowMethods mockeado a false)
    const res = makeRes();
    await handler(makeReq(), res);
    expect(allowMethods).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'GET',
      'POST',
      'DELETE',
      'PATCH',
    ]);
  });
});
