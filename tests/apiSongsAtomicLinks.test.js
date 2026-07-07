import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Env vars must be set BEFORE any module import touches process.env ────────
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

// sql mock: tagged-template fn + .begin(). El UPDATE necesita { count } en la
// respuesta (api/songs/[id].js lee result.count); las demás sentencias no
// dependen del valor de retorno.
const mockTx = vi.fn(async () => ({ count: 1 }));
const mockSql = Object.assign(
  vi.fn(async () => ({ count: 1 })),
  { begin: vi.fn(async (cb) => cb(mockTx)), json: (v) => v },
);
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

function insertCallsFor(table) {
  return mockTx.mock.calls.filter(
    (args) =>
      Array.isArray(args[0]) &&
      args[0].raw &&
      args[0].some((s) => typeof s === 'string' && s.includes(`INSERT INTO ${table}`)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.begin.mockImplementation(async (cb) => cb(mockTx));
  mockTx.mockResolvedValue({ count: 1 });
  mockSql.mockResolvedValue({ count: 1 });
});

const updateHandler = (await import('../api/songs/[id].js')).default;
const createHandler = (await import('../api/songs/index.js')).default;

describe('PUT /api/songs/[id].js — guardado atómico con links', () => {
  const handler = updateHandler;

  function makeReq(body) {
    return { method: 'PUT', query: { id: 'song-1' }, body };
  }

  it('sin platformLinks/voiceLinks: comportamiento actual intacto (no toca las tablas de links)', async () => {
    const req = makeReq({ title: 'X' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(insertCallsFor('song_platform_links')).toHaveLength(0);
    expect(insertCallsFor('song_voice_links')).toHaveLength(0);
  });

  it('con platformLinks/voiceLinks válidos: guarda canción + links en la misma transacción', async () => {
    const req = makeReq({
      title: 'X',
      platformLinks: [{ platform: 'youtube', url: 'https://youtube.com/x' }],
      voiceLinks: [{ voiceType: 'soprano', url: 'https://example.com/s.mp3', label: null }],
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(mockSql.begin).toHaveBeenCalledTimes(1);
    expect(insertCallsFor('song_platform_links')).toHaveLength(1);
    expect(insertCallsFor('song_voice_links')).toHaveLength(1);
  });

  it('con un link inválido: responde 400 y no persiste nada (rollback de toda la tx)', async () => {
    const req = makeReq({
      title: 'X',
      platformLinks: [{ platform: 'youtube', url: 'javascript:alert(1)' }],
      voiceLinks: [],
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('url_invalida');
    // Ninguna tabla recibió INSERT (ni songs ni links): la tx completa se revierte.
    expect(insertCallsFor('song_platform_links')).toHaveLength(0);
    expect(insertCallsFor('song_voice_links')).toHaveLength(0);
  });
});

describe('POST /api/songs/index.js — creación atómica con links', () => {
  const handler = createHandler;

  function makeReq(body) {
    return { method: 'POST', query: {}, body };
  }

  it('sin links: comportamiento actual intacto', async () => {
    const req = makeReq({ id: 'song-2', title: 'Y' });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(201);
    expect(insertCallsFor('song_platform_links')).toHaveLength(0);
  });

  it('con links válidos: crea canción + links en la misma transacción', async () => {
    const req = makeReq({
      id: 'song-2',
      title: 'Y',
      platformLinks: [{ platform: 'spotify', url: 'https://spotify.com/a' }],
      voiceLinks: [],
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(201);
    expect(insertCallsFor('song_platform_links')).toHaveLength(1);
  });

  it('con un link inválido: la tx entera falla con 400 (en Postgres real, rollback de canción+links)', async () => {
    const req = makeReq({
      id: 'song-2',
      title: 'Y',
      platformLinks: [],
      voiceLinks: [{ voiceType: 'soprano', url: 'data:text/html,x' }],
    });
    const res = makeRes();
    await handler(req, res);
    // El callback de sql.begin lanza → la promesa de begin() se rechaza →
    // withErrors responde 400. En Postgres real esto revierte toda la tx
    // (INSERT de songs incluido), no solo los links.
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('url_invalida');
    expect(insertCallsFor('song_voice_links')).toHaveLength(0);
  });
});
