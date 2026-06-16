import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @supabase/supabase-js BEFORE importing helpers
const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

// sql mock: tagged-template that returns queued responses
const sqlResponses = [];
function sqlMock(strings, ...values) {
  if (!strings.raw) return strings;
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('postgres', () => ({ default: () => sqlMock }));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/admin/profiles.js')).default;

function makeRes() {
  const res = {
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
  return res;
}

function makeReq(over = {}) {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer tok' },
    ...over,
  };
}

beforeEach(() => {
  mockGetUser.mockReset();
  sqlResponses.length = 0;
  delete process.env.ADMIN_EMAILS;
});

describe('GET /api/admin/profiles', () => {
  it('405 para métodos no permitidos', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('403 si el usuario no es admin', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'user@b.com' } },
      error: null,
    });
    // profiles.is_admin = false
    sqlResponses.push([{ is_admin: false }]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(403);
  });

  it('401 si no hay token', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
  });

  it('devuelve { users: [...] } con id/username/displayName para admin', async () => {
    process.env.ADMIN_EMAILS = 'admin@b.com';
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'admin@b.com' } },
      error: null,
    });
    const sampleProfiles = [
      { id: 'p1', username: 'samu', displayName: 'Samuel' },
      { id: 'p2', username: 'mari', displayName: null },
    ];
    sqlResponses.push(sampleProfiles);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ users: sampleProfiles });
  });

  it('devuelve arreglo vacío cuando no hay perfiles con username', async () => {
    process.env.ADMIN_EMAILS = 'admin@b.com';
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'admin@b.com' } },
      error: null,
    });
    sqlResponses.push([]);

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ users: [] });
  });
});
