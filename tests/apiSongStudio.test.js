/**
 * apiSongStudio.test.js — TDD para /api/songs/[id]/studio (Task D4a): lectura
 * pública (requireUser) del Estudio de una canción. 404 sin stems publicados,
 * 200 con stems firmados + análisis + secciones + timings + título.
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
}));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
}));
vi.mock('../api/_lib/storage.js', () => ({
  signSongAudioDownload: vi.fn((key) => Promise.resolve(`https://get/${key}`)),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/songs/[id]/studio.js')).default;
const { requireUser } = await import('../api/_lib/auth.js');
const { signSongAudioDownload } = await import('../api/_lib/storage.js');

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

describe('GET /api/songs/[id]/studio', () => {
  it('sin stems → 404', async () => {
    sqlResponses.push([]); // SELECT song_stems
    sqlResponses.push([]); // SELECT song_pitch_analysis
    sqlResponses.push([]); // SELECT songs
    sqlResponses.push([]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(requireUser).toHaveBeenCalled();
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Esta canción todavía no tiene estudio publicado' });
    expect(signSongAudioDownload).not.toHaveBeenCalled();
  });

  it('con stems → 200 con stems firmados + analysis + sections + timings + title', async () => {
    sqlResponses.push([
      { kind: 'vocals', storageKey: 'song-1/vocals.mp3', durationSec: 210, display: 'Voz' },
      {
        kind: 'instrumental',
        storageKey: 'song-1/instrumental.mp3',
        durationSec: 210,
        display: null,
      },
    ]); // SELECT song_stems
    sqlResponses.push([{ analysis: { notes: [1, 2, 3] } }]); // SELECT song_pitch_analysis
    sqlResponses.push([{ sections: [{ id: 's1' }], title: 'Mi canción' }]); // SELECT songs
    sqlResponses.push([{ status: 'ready', lines: [{ i: 0, startMs: 100 }] }]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      stems: [
        { kind: 'vocals', url: 'https://get/song-1/vocals.mp3', display: 'Voz', durationSec: 210 },
        {
          kind: 'instrumental',
          url: 'https://get/song-1/instrumental.mp3',
          display: null,
          durationSec: 210,
        },
      ],
      analysis: { notes: [1, 2, 3] },
      sections: [{ id: 's1' }],
      timings: { status: 'ready', lines: [{ i: 0, startMs: 100 }] },
      title: 'Mi canción',
    });
    expect(signSongAudioDownload).toHaveBeenCalledTimes(2);
    expect(signSongAudioDownload).toHaveBeenCalledWith('song-1/vocals.mp3');
    expect(signSongAudioDownload).toHaveBeenCalledWith('song-1/instrumental.mp3');
  });

  it('sin analysis/sections/timings → analysis:null, sections:[], timings:null', async () => {
    sqlResponses.push([
      { kind: 'vocals', storageKey: 'song-1/vocals.mp3', durationSec: null, display: null },
    ]); // SELECT song_stems
    sqlResponses.push([]); // SELECT song_pitch_analysis
    sqlResponses.push([{ sections: null, title: 'Mi canción' }]); // SELECT songs
    sqlResponses.push([]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body.analysis).toBeNull();
    expect(res._body.sections).toEqual([]);
    expect(res._body.timings).toBeNull();
  });

  it('requireUser exigido: si lanza 401, el handler propaga el error', async () => {
    requireUser.mockRejectedValueOnce(Object.assign(new Error('No autorizado'), { status: 401 }));
    const res = makeRes();
    await expect(handler(makeReq(), res)).rejects.toThrow('No autorizado');
  });

  it('sin id → 400', async () => {
    const res = makeRes();
    await handler(makeReq({ query: {} }), res);
    expect(res._status).toBe(400);
  });
});
