import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockCreateSignedUploadUrl = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    storage: {
      from: () => ({
        createSignedUploadUrl: mockCreateSignedUploadUrl,
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  }),
}));

// sql mock: función template-tag que devuelve respuestas encoladas
const sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  // Tagged template: strings is a TemplateStringsArray (has .raw); direct call for IN list: plain array
  if (!strings.raw) {
    // Called as sql(array) for IN interpolation — return the array itself as a passthrough value
    return strings;
  }
  sqlCalls.push({ text: strings.join('?'), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('postgres', () => ({ default: () => sqlMock }));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/stems/jobs.js')).default;

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

const authedReq = (over = {}) => ({
  method: 'POST',
  headers: { authorization: 'Bearer tok' },
  body: { filename: 'a.mp3', size: 1024, mime: 'audio/mpeg' },
  ...over,
});

beforeEach(() => {
  mockGetUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null });
  mockCreateSignedUploadUrl
    .mockReset()
    .mockResolvedValue({ data: { path: 'p', token: 't' }, error: null });
  sqlResponses.length = 0;
  sqlCalls.length = 0;
});

describe('POST /api/stems/jobs', () => {
  it('409 solo si hay un job realmente en proceso', async () => {
    sqlResponses.push([]); // reclamo de created/uploaded huérfanos
    sqlResponses.push([{ id: 'job-activo' }]); // job en separating_*
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(409);
  });

  it('reclama un created huérfano y deja crear uno nuevo (regresión del 409)', async () => {
    sqlResponses.push([{ id: 'old', input_path: 'u1/old/input/a.mp3' }]); // reclamo huérfano
    sqlResponses.push([]); // ya no hay job en proceso
    sqlResponses.push([{ n: 0 }]); // cuota 0/3
    sqlResponses.push([{ id: 'j2', status: 'created' }]); // INSERT ... RETURNING
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.job.id).toBe('j2');
  });

  it('429 si la cuota diaria está agotada', async () => {
    sqlResponses.push([]); // reclamo
    sqlResponses.push([]); // sin job en proceso
    sqlResponses.push([{ n: 3 }]); // cuota usada
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(429);
  });

  it('400 si el archivo no es audio', async () => {
    sqlResponses.push([]); // reclamo
    sqlResponses.push([]); // sin job en proceso
    sqlResponses.push([{ n: 0 }]);
    const res = makeRes();
    await handler(
      authedReq({ body: { filename: 'x.pdf', size: 99, mime: 'application/pdf' } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('crea el job y devuelve upload firmado', async () => {
    sqlResponses.push([]); // reclamo
    sqlResponses.push([]); // sin job en proceso
    sqlResponses.push([{ n: 1 }]); // cuota 1/3
    sqlResponses.push([{ id: 'j1', status: 'created' }]); // INSERT ... RETURNING
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.job.id).toBe('j1');
    expect(res.body.upload).toEqual({ path: 'p', token: 't' });
  });
});

describe('GET /api/stems/jobs', () => {
  it('lista jobs vigentes + cuota', async () => {
    sqlResponses.push([{ id: 'j1', status: 'done' }]); // jobs
    sqlResponses.push([{ n: 2 }]); // cuota usada
    const res = makeRes();
    await handler(authedReq({ method: 'GET', body: undefined }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.quota).toEqual({ used: 2, limit: 3 });
  });
});
