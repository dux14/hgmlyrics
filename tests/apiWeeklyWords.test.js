// tests/apiWeeklyWords.test.js (parte 1 — ordo proxy)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}));
vi.mock('postgres', () => ({ default: () => sqlMock }));

const sqlResponses = [];
function sqlMock(strings, ...values) {
  if (!strings.raw) return strings;
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.begin = async (fn) => fn(sqlMock);

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';
process.env.ADMIN_EMAILS = 'admin@test.com';

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

const ordoHandler = (await import('../api/ordo/[date].js')).default;

describe('GET /api/ordo/[date]', () => {
  beforeEach(() => {
    sqlResponses.length = 0;
    mockGetUser.mockReset();
  });

  it('devuelve 401 sin token', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no token') });
    const req = { method: 'GET', headers: {}, query: { date: '2026-06-15' } };
    const res = makeRes();
    await ordoHandler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 400 para fecha inválida', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'admin@test.com' } },
      error: null,
    });
    // admin@test.com en ADMIN_EMAILS → sin SQL
    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer t' },
      query: { date: 'no-es-fecha' },
    };
    const res = makeRes();
    await ordoHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('devuelve campos del ordo para fecha válida (mock fetch)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'admin@test.com' } },
      error: null,
    });
    // admin@test.com en ADMIN_EMAILS → sin SQL
    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            fecha: '2026-06-15',
            evangelio: '<strong>Jn 14,6</strong><p>Yo soy el camino.</p>',
            tiempo_liturgico: 'TIEMPO ORDINARIO',
            colores_dia: 'green',
            encabezado: 'XI Domingo del Tiempo Ordinario',
            celebracion: '',
          },
        ],
      }),
    });
    global.fetch = mockFetch;
    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer t' },
      query: { date: '2026-06-15' },
    };
    const res = makeRes();
    await ordoHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.gospelRef).toBe('Jn 14,6');
    expect(res.body.liturgicalColor).toBe('green');
    expect(res.body.gospelBody).toContain('Yo soy el camino');
  });
});

// ---- weekly-words CRUD ----

const wwIndexHandler = (await import('../api/weekly-words/index.js')).default;
const wwIdHandler = (await import('../api/weekly-words/[id].js')).default;

describe('GET /api/weekly-words', () => {
  beforeEach(() => {
    sqlResponses.length = 0;
    mockGetUser.mockReset();
  });

  it('devuelve lista de publicadas para usuario autenticado', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'user@test.com' } },
      error: null,
    });
    sqlResponses.push([
      {
        id: 'ww1',
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_color: 'green',
        published: true,
      },
    ]);
    const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: {} };
    const res = makeRes();
    await wwIndexHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.weeklyWords).toHaveLength(1);
    expect(res.body.weeklyWords[0].id).toBe('ww1');
  });
});

describe('POST /api/weekly-words', () => {
  beforeEach(() => {
    sqlResponses.length = 0;
    mockGetUser.mockReset();
  });

  it('crea una voz en off como admin', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'admin@test.com' } },
      error: null,
    });
    // admin@test.com en ADMIN_EMAILS → isAdminUser retorna true sin SQL
    sqlResponses.push([
      {
        id: 'ww-new',
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_title: 'XI Domingo',
        liturgical_color: 'green',
        voiceover_body: 'Texto de prueba',
        gospel_body: 'El evangelio.',
        published: false,
      },
    ]);
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: {
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_title: 'XI Domingo',
        liturgical_color: 'green',
        voiceover_body: 'Texto de prueba',
        gospel_body: 'El evangelio.',
      },
      query: {},
    };
    const res = makeRes();
    await wwIndexHandler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe('ww-new');
  });

  it('rechaza POST sin admin (403)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'user@test.com' } },
      error: null,
    });
    sqlResponses.push([{ is_admin: false }]);
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { sunday_date: '2026-06-15', gospel_ref: 'Jn 14,6', voiceover_body: 'X' },
      query: {},
    };
    const res = makeRes();
    await wwIndexHandler(req, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /api/weekly-words/[id]', () => {
  beforeEach(() => {
    sqlResponses.length = 0;
    mockGetUser.mockReset();
  });

  it('publica una voz en off existente como admin', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'admin@test.com' } },
      error: null,
    });
    // admin@test.com está en ADMIN_EMAILS → isAdminUser retorna true sin SQL
    sqlResponses.push([
      {
        id: 'ww1',
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_title: 'XI Domingo',
        liturgical_color: 'green',
        voiceover_body: 'X',
        gospel_body: 'Y',
        published: true,
      },
    ]);
    const req = {
      method: 'PATCH',
      headers: { authorization: 'Bearer t' },
      body: { published: true },
      query: { id: 'ww1' },
    };
    const res = makeRes();
    await wwIdHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.published).toBe(true);
  });
});

describe('GET /api/weekly-words/[id]', () => {
  beforeEach(() => {
    sqlResponses.length = 0;
    mockGetUser.mockReset();
  });

  it('devuelve detalle de una publicada para usuario autenticado', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'user@test.com' } },
      error: null,
    });
    sqlResponses.push([{ is_admin: false }]); // isAdminUser → profiles (no admin)
    sqlResponses.push([
      {
        id: 'ww1',
        sunday_date: '2026-06-15',
        gospel_ref: 'Jn 14,6',
        liturgical_title: 'XI Domingo',
        liturgical_color: 'green',
        voiceover_body: 'Voz en off',
        gospel_body: 'Evangelio',
        published: true,
      },
    ]);
    const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: { id: 'ww1' } };
    const res = makeRes();
    await wwIdHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.voiceover_body).toBe('Voz en off');
  });

  it('devuelve 404 para id inexistente', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'user@test.com' } },
      error: null,
    });
    sqlResponses.push([{ is_admin: false }]); // isAdminUser → profiles (no admin)
    sqlResponses.push([]);
    const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: { id: 'nope' } };
    const res = makeRes();
    await wwIdHandler(req, res);
    expect(res.statusCode).toBe(404);
  });
});
