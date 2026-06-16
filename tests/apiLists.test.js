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
  it('crea sub-lista válida bajo un evento del usuario', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      { id: 'evt1', owner_id: 'u1', parent_id: null, expires_at: '2026-06-20T00:00:00Z' },
    ]); // SELECT padre
    sqlResponses.push([{ id: 'sub1', name: 'Ensayo', expires_at: '2026-06-18T00:00:00Z' }]); // INSERT
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { name: 'Ensayo', expires_at: '2026-06-18T00:00:00Z', parent_id: 'evt1' },
    };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe('sub1');
  });

  it('rechaza sub-lista cuya caducidad excede al evento (400)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      { id: 'evt1', owner_id: 'u1', parent_id: null, expires_at: '2026-06-15T00:00:00Z' },
    ]);
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { name: 'Ensayo', expires_at: '2026-06-20T00:00:00Z', parent_id: 'evt1' },
    };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rechaza colgar de una sub-lista (profundidad, 400)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      { id: 'sub1', owner_id: 'u1', parent_id: 'evt1', expires_at: '2026-06-18T00:00:00Z' },
    ]);
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { name: 'Sub-sub', expires_at: '2026-06-17T00:00:00Z', parent_id: 'sub1' },
    };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('404 si el evento padre no es del usuario', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([]); // SELECT padre vacío
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: { name: 'Ensayo', expires_at: '2026-06-18T00:00:00Z', parent_id: 'ajeno' },
    };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(404);
  });

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

describe('GET /api/lists', () => {
  it('devuelve un array de listas (consumible con .map en el sidebar)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      { id: 'list1', name: 'hora santa', expires_at: '2026-06-11T14:31:42Z', is_owner: true },
    ]);
    const req = { method: 'GET', headers: { authorization: 'Bearer t' } };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('hora santa');
  });

  it('incluye child_count y solo primer nivel', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      {
        id: 'evt1',
        name: 'Concierto',
        expires_at: '2026-06-20T00:00:00Z',
        is_owner: true,
        child_count: 2,
      },
    ]);
    const req = { method: 'GET', headers: { authorization: 'Bearer t' } };
    const res = makeRes();
    await indexHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body[0].child_count).toBe(2);
  });
});

const idHandler = (await import('../api/lists/[id].js')).default;

describe('GET /api/lists/:id', () => {
  it('devuelve detalle con canciones ordenadas para el dueño', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      { id: 'list1', name: 'L', owner_id: 'u1', expires_at: '2026-06-20T00:00:00Z' },
    ]); // list
    sqlResponses.push([
      { item_type: 'song', item_id: 's1', position: 0 },
      { item_type: 'song', item_id: 's2', position: 1 },
    ]); // items (ephemeral_list_items)
    sqlResponses.push([{ user_id: 'u2', username: 'bob' }]); // members
    const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: { id: 'list1' } };
    const res = makeRes();
    await idHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.role).toBe('owner');
    expect(res.body.songs).toEqual(['s1', 's2']);
  });

  it('404 si no es dueño ni miembro', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u9' } }, error: null });
    sqlResponses.push([]); // list query (filtrada por acceso) vacía
    const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: { id: 'list1' } };
    const res = makeRes();
    await idHandler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it('DELETE solo dueño', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([{ id: 'list1' }]); // DELETE ... RETURNING
    const req = {
      method: 'DELETE',
      headers: { authorization: 'Bearer t' },
      query: { id: 'list1' },
    };
    const res = makeRes();
    await idHandler(req, res);
    expect(res.statusCode).toBe(204);
  });

  it('incluye children y parent', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      {
        id: 'evt1',
        name: 'Concierto',
        owner_id: 'u1',
        expires_at: '2026-06-20T00:00:00Z',
        parent_id: null,
      },
    ]); // list
    sqlResponses.push([{ item_type: 'song', item_id: 's1', position: 0 }]); // items
    sqlResponses.push([{ user_id: 'u2', username: 'bob' }]); // members
    sqlResponses.push([
      { id: 'sub1', name: 'Ensayo', expires_at: '2026-06-18T00:00:00Z', song_count: 3 },
    ]); // children
    const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: { id: 'evt1' } };
    const res = makeRes();
    await idHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.children).toHaveLength(1);
    expect(res.body.children[0].id).toBe('sub1');
    expect(res.body.parent).toBeNull();
  });
});

describe('PATCH /api/lists/:id (jerarquía)', () => {
  it('rechaza poner la caducidad del hijo por encima del padre (400)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      { id: 'sub1', owner_id: 'u1', parent_id: 'evt1', expires_at: '2026-06-18T00:00:00Z' },
    ]); // SELECT actual
    sqlResponses.push([{ expires_at: '2026-06-20T00:00:00Z' }]); // SELECT padre
    const req = {
      method: 'PATCH',
      headers: { authorization: 'Bearer t' },
      query: { id: 'sub1' },
      body: { expires_at: '2026-06-25T00:00:00Z' },
    };
    const res = makeRes();
    await idHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rechaza adelantar el evento por debajo de un hijo vivo (400)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      { id: 'evt1', owner_id: 'u1', parent_id: null, expires_at: '2026-06-20T00:00:00Z' },
    ]); // SELECT actual
    sqlResponses.push([{ m: '2026-06-19T00:00:00Z' }]); // max hijo vivo
    const req = {
      method: 'PATCH',
      headers: { authorization: 'Bearer t' },
      query: { id: 'evt1' },
      body: { expires_at: '2026-06-15T00:00:00Z' },
    };
    const res = makeRes();
    await idHandler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('actualiza nombre sin tocar caducidad', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([
      { id: 'evt1', owner_id: 'u1', parent_id: null, expires_at: '2026-06-20T00:00:00Z' },
    ]); // SELECT actual
    sqlResponses.push([{ id: 'evt1', name: 'Nuevo', expires_at: '2026-06-20T00:00:00Z' }]); // UPDATE
    const req = {
      method: 'PATCH',
      headers: { authorization: 'Bearer t' },
      query: { id: 'evt1' },
      body: { name: 'Nuevo' },
    };
    const res = makeRes();
    await idHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('Nuevo');
  });
});

const songsHandler = (await import('../api/lists/[id]/songs.js')).default;

describe('PUT /api/lists/:id/songs', () => {
  it('reemplaza el orden completo (solo dueño)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([{ id: 'list1' }]); // verifica ownership
    sqlResponses.push([{ id: 's1' }, { id: 's2' }]); // songs existen
    sqlResponses.push([]); // DELETE viejos (dentro de begin)
    sqlResponses.push([]); // INSERT nuevos
    const req = {
      method: 'PUT',
      headers: { authorization: 'Bearer t' },
      query: { id: 'list1' },
      body: { songIds: ['s1', 's2'] },
    };
    const res = makeRes();
    await songsHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('403 si no es dueño', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u9' } }, error: null });
    sqlResponses.push([]); // ownership vacío
    const req = {
      method: 'PUT',
      headers: { authorization: 'Bearer t' },
      query: { id: 'list1' },
      body: { songIds: ['s1'] },
    };
    const res = makeRes();
    await songsHandler(req, res);
    expect(res.statusCode).toBe(403);
  });
});

const membersHandler = (await import('../api/lists/[id]/members.js')).default;

describe('POST /api/lists/:id/members', () => {
  it('admin invita a cualquiera por username', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([{ id: 'list1' }]); // ownership
    sqlResponses.push([{ id: 'u2', username: 'bob' }]); // profile por username
    sqlResponses.push([{ is_admin: true }]); // isAdminUser → admin, salta check de amistad
    sqlResponses.push([]); // INSERT member (ON CONFLICT)
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      query: { id: 'list1' },
      body: { username: 'bob' },
    };
    const res = makeRes();
    await membersHandler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.user_id).toBe('u2');
  });

  it('no-admin no puede invitar a un no-amigo (403)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([{ id: 'list1' }]); // ownership
    sqlResponses.push([{ id: 'u2', username: 'bob' }]); // profile por username
    sqlResponses.push([{ is_admin: false }]); // isAdminUser → no admin
    sqlResponses.push([]); // friendship → sin amistad aceptada
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      query: { id: 'list1' },
      body: { username: 'bob' },
    };
    const res = makeRes();
    await membersHandler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('no-admin sí puede invitar a un amigo aceptado', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([{ id: 'list1' }]); // ownership
    sqlResponses.push([{ id: 'u2', username: 'bob' }]); // profile por username
    sqlResponses.push([{ is_admin: false }]); // isAdminUser → no admin
    sqlResponses.push([{ ok: 1 }]); // friendship → amistad aceptada
    sqlResponses.push([]); // INSERT member (ON CONFLICT)
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      query: { id: 'list1' },
      body: { username: 'bob' },
    };
    const res = makeRes();
    await membersHandler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.user_id).toBe('u2');
  });

  it('404 si el username no existe', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([{ id: 'list1' }]); // ownership
    sqlResponses.push([]); // username no encontrado
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      query: { id: 'list1' },
      body: { username: 'ghost' },
    };
    const res = makeRes();
    await membersHandler(req, res);
    expect(res.statusCode).toBe(404);
  });
});
