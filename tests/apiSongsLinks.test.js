import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Env vars must be set BEFORE any module import touches process.env ────────
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));
vi.mock('postgres', () => ({
  default: () => Object.assign(() => Promise.resolve([]), { json: (v) => v }),
}));

// sql mock: tagged-template fn + .begin()
const mockTx = vi.fn(async () => []);
const mockSql = Object.assign(
  vi.fn(async () => []),
  {
    begin: vi.fn(async (cb) => cb(mockTx)),
  },
);
vi.mock('../api/_lib/db.js', () => ({ default: mockSql }));

vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
}));

const handler = (await import('../api/songs/[id]/links.js')).default;

function makeReq(body) {
  return {
    method: 'PUT',
    query: { id: 'song-1' },
    body,
  };
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
  mockSql.begin.mockImplementation(async (cb) => cb(mockTx));
  mockTx.mockResolvedValue([]);
});

describe('PUT /api/songs/[id]/links — URL scheme validation', () => {
  it('rejects platform url with javascript: scheme → throws url_invalida, no INSERT written', async () => {
    const req = makeReq({
      platforms: [{ platform: 'youtube', url: 'javascript:alert(1)' }],
      voices: [],
    });
    const res = makeRes();
    await expect(handler(req, res)).rejects.toThrow('url_invalida');
    // tx is called for the initial DELETEs but must NOT reach INSERT
    const insertCalls = mockTx.mock.calls.filter(
      (args) =>
        Array.isArray(args[0]) &&
        args[0].some((s) => typeof s === 'string' && s.includes('INSERT')),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects voice url with data: scheme → throws url_invalida', async () => {
    const req = makeReq({
      platforms: [],
      voices: [{ voiceType: 'soprano', url: 'data:text/html,<script>x</script>', label: null }],
    });
    const res = makeRes();
    await expect(handler(req, res)).rejects.toThrow('url_invalida');
  });

  it('accepts platform url with https: scheme → 200 success', async () => {
    const req = makeReq({
      platforms: [{ platform: 'youtube', url: 'https://youtube.com/x' }],
      voices: [],
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ success: true });
  });

  it('accepts voice url with http: scheme → 200 success', async () => {
    const req = makeReq({
      platforms: [],
      voices: [{ voiceType: 'tenor', url: 'http://example.com/track.mp3', label: 'Tenor 1' }],
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it('skips entries without url field (no error) → 200 success', async () => {
    const req = makeReq({
      platforms: [{ platform: 'spotify' }], // no url key
      voices: [],
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it('empty arrays → 200 success', async () => {
    const req = makeReq({ platforms: [], voices: [] });
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });
});
