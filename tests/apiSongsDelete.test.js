import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Env vars must be set BEFORE any module import touches process.env ────────
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

// sql mock: distingue por el texto de la query. remove() en api/songs/[id].js
// hace 2 SELECT (song_section_audio, song_audio) y luego el DELETE FROM songs
// que necesita { count } (el handler lo lee para decidir 404 vs 200).
let sectionRows = [];
let audioRows = [];
const mockSqlFn = vi.fn(async (strings) => {
  const text = strings.join('');
  if (text.includes('FROM song_section_audio')) return sectionRows;
  if (text.includes('FROM song_audio')) return audioRows;
  if (text.includes('DELETE FROM songs')) return { count: 1 };
  return { count: 1 };
});
const mockSql = Object.assign(mockSqlFn, { begin: vi.fn(), json: (v) => v });
vi.mock('../api/_lib/db.js', () => ({ default: mockSql }));

vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'Error' });
    }
  },
}));
vi.mock('../src/lib/musicKeys.js', () => ({ isValidKey: () => true }));
vi.mock('../src/lib/voiceSystem.js', () => ({
  validateSongV2: vi.fn(),
  validateSongV3: vi.fn(),
}));

const deleteSongAudioObject = vi.fn(async () => {});
vi.mock('../api/_lib/storage.js', () => ({ deleteSongAudioObject }));

vi.mock('../api/songs/index.js', () => ({ invalidateListCache: vi.fn() }));

function makeReq() {
  return { method: 'DELETE', query: { id: 'song-1' } };
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

const handler = (await import('../api/songs/[id].js')).default;

describe('DELETE /api/songs/[id].js — limpieza de Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sectionRows = [];
    audioRows = [];
  });

  it('borra los objetos de Storage de ambas tablas ANTES del DELETE FROM songs', async () => {
    sectionRows = [{ storageKey: 'song-1/section-0.mp3' }, { storageKey: 'song-1/section-1.mp3' }];
    audioRows = [{ storageKey: 'song-1/full.mp3' }];

    const res = makeRes();
    await handler(makeReq(), res);

    expect(deleteSongAudioObject).toHaveBeenCalledTimes(3);
    expect(deleteSongAudioObject).toHaveBeenCalledWith('song-1/section-0.mp3');
    expect(deleteSongAudioObject).toHaveBeenCalledWith('song-1/section-1.mp3');
    expect(deleteSongAudioObject).toHaveBeenCalledWith('song-1/full.mp3');

    // El DELETE FROM songs debe quedar registrado en el mock DESPUES de las
    // llamadas de storage (mismo orden que impone la funcion remove()).
    const deleteCallIndex = mockSqlFn.mock.calls.findIndex((args) =>
      args[0].join('').includes('DELETE FROM songs'),
    );
    const lastStorageCallOrder = deleteSongAudioObject.mock.invocationCallOrder.at(-1);
    const deleteCallOrder = mockSqlFn.mock.invocationCallOrder[deleteCallIndex];
    expect(lastStorageCallOrder).toBeLessThan(deleteCallOrder);

    expect(res._status).toBe(200);
  });

  it('cancion sin audios: cero llamadas al helper de storage', async () => {
    const res = makeRes();
    await handler(makeReq(), res);

    expect(deleteSongAudioObject).not.toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('si el helper de storage falla, no se borra la fila (falla antes)', async () => {
    sectionRows = [{ storageKey: 'song-1/section-0.mp3' }];
    deleteSongAudioObject.mockRejectedValueOnce(new Error('storage down'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(500);
    const deleteCalled = mockSqlFn.mock.calls.some((args) =>
      args[0].join('').includes('DELETE FROM songs'),
    );
    expect(deleteCalled).toBe(false);
  });
});
