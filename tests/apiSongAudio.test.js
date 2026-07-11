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
    sqlResponses.push([{ storageKey: 'song-1/full.mp3', durationSec: 210 }]); // SELECT song_audio
    sqlResponses.push([{ status: 'ready', lines: [{ i: 0, startMs: 100 }] }]); // SELECT song_line_timings
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      audio: { url: 'https://get/song-1/full.mp3', durationSec: 210 },
      timings: { status: 'ready', lines: [{ i: 0, startMs: 100 }] },
    });
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
