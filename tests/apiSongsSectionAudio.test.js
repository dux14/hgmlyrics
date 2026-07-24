/**
 * apiSongsSectionAudio.test.js — TDD para /api/songs/[id]/section-audio
 * GET (lista con URLs firmadas), POST (valida+firma PUT+upsert), DELETE (borra fila+storage).
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
  signSongAudioDownloads: vi.fn((keys) => Promise.resolve(keys.map((key) => `https://get/${key}`))),
  deleteSongAudioObject: vi.fn(async () => {}),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/songs/[id]/section-audio.js')).default;
const { requireUser, requireAdmin } = await import('../api/_lib/auth.js');
const { createSongAudioSignedPutUrl, deleteSongAudioObject } =
  await import('../api/_lib/storage.js');

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

describe('GET /api/songs/[id]/section-audio', () => {
  it('lista filas con URL firmada por fila', async () => {
    sqlResponses.push([
      {
        id: 'a1',
        sectionIndex: 0,
        voiceScope: null,
        storageKey: 'song-1/section-0.mp3',
        label: null,
        durationSec: null,
      },
    ]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(requireUser).toHaveBeenCalled();
    expect(res._status).toBe(200);
    expect(res._body.items).toEqual([
      {
        id: 'a1',
        sectionIndex: 0,
        voiceScope: null,
        label: null,
        durationSec: null,
        url: 'https://get/song-1/section-0.mp3',
      },
    ]);
  });

  it('sin filas devuelve items: []', async () => {
    sqlResponses.push([]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ items: [] });
  });
});

describe('POST /api/songs/[id]/section-audio', () => {
  function postReq(body) {
    return makeReq({ method: 'POST', body });
  }

  it('sectionIndex fuera de rango → 400, no llega a INSERT', async () => {
    sqlResponses.push([{ sections: [{}, {}] }]); // canción con 2 secciones
    const res = makeRes();
    await handler(postReq({ sectionIndex: 5 }), res);
    expect(res._status).toBe(400);
    expect(createSongAudioSignedPutUrl).not.toHaveBeenCalled();
  });

  it('no-admin → 403 (requireAdmin lanza)', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res = makeRes();
    await expect(handler(postReq({ sectionIndex: 0 }), res)).rejects.toThrow('Forbidden');
  });

  it('construye key correcta SIN voiceScope', async () => {
    sqlResponses.push([{ sections: [{}] }]);
    sqlResponses.push([{ id: 'row-1' }]); // INSERT ... RETURNING id
    const res = makeRes();
    await handler(postReq({ sectionIndex: 0 }), res);
    expect(res._status).toBe(200);
    expect(res._body.key).toBe('song-1/section-0.mp3');
    expect(res._body.uploadUrl).toBe('https://put/song-1/section-0.mp3');
  });

  it('construye key correcta CON voiceScope', async () => {
    sqlResponses.push([{ sections: [{}] }]);
    sqlResponses.push([{ id: 'row-2' }]);
    const res = makeRes();
    await handler(postReq({ sectionIndex: 0, voiceScope: 'tenor' }), res);
    expect(res._body.key).toBe('song-1/section-0-tenor.mp3');
  });

  it('voiceScope fuera de la allow-list → 400', async () => {
    const res = makeRes();
    await handler(postReq({ sectionIndex: 0, voiceScope: 'alien' }), res);
    expect(res._status).toBe(400);
  });

  it('re-subir misma sección+scope hace UPSERT (un solo INSERT ... ON CONFLICT)', async () => {
    sqlResponses.push([{ sections: [{}] }]);
    sqlResponses.push([{ id: 'row-1' }]);
    const res = makeRes();
    await handler(postReq({ sectionIndex: 0 }), res);
    const insertCall = sqlCalls.find((c) => c.text.includes('INSERT INTO song_section_audio'));
    expect(insertCall.text).toContain('ON CONFLICT');
    expect(insertCall.text).toContain('DO UPDATE');
  });
});

describe('DELETE /api/songs/[id]/section-audio', () => {
  function deleteReq(body) {
    return makeReq({ method: 'DELETE', body });
  }

  it('borra fila y storage', async () => {
    sqlResponses.push([{ storageKey: 'song-1/section-0.mp3' }]); // SELECT
    sqlResponses.push([]); // DELETE
    const res = makeRes();
    await handler(deleteReq({ id: 'a1' }), res);
    expect(deleteSongAudioObject).toHaveBeenCalledWith('song-1/section-0.mp3');
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true });
  });

  it('id ajeno/inexistente → 404', async () => {
    sqlResponses.push([]); // SELECT no encuentra fila
    const res = makeRes();
    await handler(deleteReq({ id: 'no-existe' }), res);
    expect(res._status).toBe(404);
    expect(deleteSongAudioObject).not.toHaveBeenCalled();
  });
});
