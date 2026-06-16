// tests/apiListsItems.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}));

const sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings.raw) return strings;
  sqlCalls.push({ text: strings.join('?'), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.begin = async (fn) => fn(sqlMock);
vi.mock('postgres', () => ({ default: () => sqlMock }));

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
    end() {
      return this;
    },
  };
}

const listIdHandler = (await import('../api/lists/[id].js')).default;
const listSongsHandler = (await import('../api/lists/[id]/songs.js')).default;

beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  mockGetUser.mockReset();
});

describe('GET /api/lists/[id] — typed items', () => {
  it('devuelve items mezclados (song + weekly_word) en orden de posición', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    // SELECT list
    sqlResponses.push([
      { id: 'l1', name: 'Mi lista', expires_at: '2099-01-01', owner_id: 'u1', parent_id: null },
    ]);
    // SELECT items
    sqlResponses.push([
      { item_type: 'song', item_id: 's1', position: 0 },
      { item_type: 'weekly_word', item_id: 'ww1', position: 1 },
    ]);
    // SELECT weekly_words metadata (para las voces en off de los items)
    sqlResponses.push([
      {
        id: 'ww1',
        gospel_ref: 'Jn 14,6',
        title: 'XI Domingo',
        liturgical_title: 'XI TO',
        liturgical_color: 'green',
      },
    ]);
    // SELECT members
    sqlResponses.push([]);
    // SELECT children
    sqlResponses.push([]);

    const req = { method: 'GET', headers: { authorization: 'Bearer t' }, query: { id: 'l1' } };
    const res = makeRes();
    await listIdHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toEqual({ item_type: 'song', item_id: 's1', position: 0 });
    // La voz en off se enriquece con su metadata (word) para vista/editor.
    expect(res.body.items[1]).toEqual({
      item_type: 'weekly_word',
      item_id: 'ww1',
      position: 1,
      word: {
        id: 'ww1',
        gospel_ref: 'Jn 14,6',
        title: 'XI Domingo',
        liturgical_title: 'XI TO',
        liturgical_color: 'green',
      },
    });
    // songs field maintained for backward compat (song ids only)
    expect(res.body.songs).toEqual(['s1']);
  });
});

describe('PUT /api/lists/[id]/songs — typed items', () => {
  it('escribe items tipados a ephemeral_list_items', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([{ id: 'l1' }]); // ownership check

    const req = {
      method: 'PUT',
      headers: { authorization: 'Bearer t' },
      body: {
        items: [
          { item_type: 'song', item_id: 's1' },
          { item_type: 'weekly_word', item_id: 'ww1' },
        ],
      },
      query: { id: 'l1' },
    };
    const res = makeRes();
    await listSongsHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('sigue aceptando songIds legacy (retrocompatibilidad)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sqlResponses.push([{ id: 'l1' }]);
    sqlResponses.push([{ id: 's1' }]); // songs existence check

    const req = {
      method: 'PUT',
      headers: { authorization: 'Bearer t' },
      body: { songIds: ['s1'] },
      query: { id: 'l1' },
    };
    const res = makeRes();
    await listSongsHandler(req, res);
    expect(res.statusCode).toBe(200);
  });
});
