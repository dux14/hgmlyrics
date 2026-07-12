import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/songs/[id] es público (getOne no llama requireAdmin ni lee
// Authorization) → debe cachear en el edge vía cachePublic (con
// stale-if-error, que el setHeader manual no traía). Ver Task 3.4.
process.env.DATABASE_URL = 'postgresql://test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

const row = {
  id: 'song-1',
  title: 'T',
  sections: [],
  voicePercentMale: 50,
  voicePercentFemale: 50,
};
const mockSqlFn = vi.fn(async () => [row]);
const mockSql = Object.assign(mockSqlFn, { begin: vi.fn(), json: (v) => v });
vi.mock('../api/_lib/db.js', () => ({ default: mockSql }));

vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => {}),
}));

const cachePublic = vi.fn();
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
  cachePublic,
}));

function makeReq() {
  return { method: 'GET', query: { id: 'song-1' } };
}
function makeRes() {
  const res = { _status: 200, _body: null };
  res.setHeader = vi.fn();
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

describe('GET /api/songs/[id].js — cache público con stale-if-error', () => {
  beforeEach(() => {
    cachePublic.mockClear();
    mockSqlFn.mockClear();
  });

  it('usa cachePublic con sMaxage=60 (público, sin requireAdmin previo)', async () => {
    const res = makeRes();
    await handler(makeReq(), res);

    expect(cachePublic).toHaveBeenCalledTimes(1);
    expect(cachePublic).toHaveBeenCalledWith(res, { sMaxage: 60 });
    expect(res._status).toBe(200);
  });
});
