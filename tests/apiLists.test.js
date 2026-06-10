import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}));

const sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings.raw) return strings; // sql(array) passthrough
  sqlCalls.push({ text: strings.join('?'), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.begin = async (fn) => fn(sqlMock); // transacción: ejecuta inline
sqlMock.json = (v) => v;
vi.mock('postgres', () => ({ default: () => sqlMock }));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const indexHandler = (await import('../api/lists/index.js')).default;

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
beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  mockGetUser.mockReset();
});

describe('POST /api/lists', () => {
  it('crea una lista para el usuario', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } }, error: null });
    sqlResponses.push([{ id: 'list1', name: 'Mi lista', expires_at: '2026-06-20T00:00:00Z' }]);
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { name: 'Mi lista', expires_at: '2026-06-20T00:00:00Z' },
    };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe('list1');
  });

  it('rechaza caducidad en el pasado', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { name: 'X', expires_at: '2000-01-01T00:00:00Z' },
    };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('401 sin token', async () => {
    const req = { method: 'POST', headers: {}, body: {} };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(401);
  });
});
