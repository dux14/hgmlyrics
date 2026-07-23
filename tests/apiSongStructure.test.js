/**
 * apiSongStructure.test.js — TDD para PATCH /api/songs/[id]/structure (Task
 * 15d): editor admin simple de song_structure.segments (retipar label y/o
 * ajustar bordes de UN segmento). Admin-only, valida label contra el
 * 8-class de SongFormer y bordes monotonos sin solape con vecinos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));

let sqlResponses = [];
const sqlCalls = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('../api/_lib/db.js', () => ({ default: sqlMock }));

vi.mock('../api/_lib/auth.js', () => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin-1' })),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/songs/[id]/structure.js')).default;
const { requireAdmin } = await import('../api/_lib/auth.js');

function makeReq(over = {}) {
  return { method: 'PATCH', query: { id: 'song-1' }, body: {}, ...over };
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

const segments = [
  { label: 'intro', startMs: 0, endMs: 2000 },
  { label: 'verso', startMs: 2000, endMs: 8000 },
  { label: 'coro', startMs: 8000, endMs: 14000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: 'admin-1' });
  sqlResponses = [];
  sqlCalls.length = 0;
});

describe('PATCH /api/songs/[id]/structure', () => {
  it('403 si no es admin (withErrors traduce el throw de requireAdmin)', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res = makeRes();
    await handler(makeReq({ body: { segmentIndex: 0, label: 'verso' } }), res);
    expect(res._status).toBe(403);
  });

  it('404 si la cancion no tiene song_structure', async () => {
    sqlResponses.push([]); // SELECT segments
    const res = makeRes();
    await handler(makeReq({ body: { segmentIndex: 0, label: 'verso' } }), res);
    expect(res._status).toBe(404);
  });

  it('400 si segmentIndex esta fuera de rango', async () => {
    sqlResponses.push([{ segments }]);
    const res = makeRes();
    await handler(makeReq({ body: { segmentIndex: 9, label: 'verso' } }), res);
    expect(res._status).toBe(400);
  });

  it('400 si label no es uno de los 8 labels de SongFormer', async () => {
    sqlResponses.push([{ segments }]);
    const res = makeRes();
    await handler(makeReq({ body: { segmentIndex: 1, label: 'estrofa' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/label/);
  });

  it('400 si startMs >= endMs', async () => {
    sqlResponses.push([{ segments }]);
    const res = makeRes();
    await handler(makeReq({ body: { segmentIndex: 1, startMs: 8000, endMs: 3000 } }), res);
    expect(res._status).toBe(400);
  });

  it('400 si el nuevo borde se solapa con el segmento anterior', async () => {
    sqlResponses.push([{ segments }]);
    const res = makeRes();
    // segmento 1 (verso, 2000-8000): mover startMs a 1000 invade al segmento 0 (0-2000).
    await handler(makeReq({ body: { segmentIndex: 1, startMs: 1000 } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/solapa/);
  });

  it('400 si el nuevo borde se solapa con el segmento siguiente', async () => {
    sqlResponses.push([{ segments }]);
    const res = makeRes();
    // segmento 1 (verso, 2000-8000): mover endMs a 9000 invade al segmento 2 (8000-14000).
    await handler(makeReq({ body: { segmentIndex: 1, endMs: 9000 } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/solapa/);
  });

  it('400 sin ningun campo para actualizar', async () => {
    sqlResponses.push([{ segments }]);
    const res = makeRes();
    await handler(makeReq({ body: { segmentIndex: 1 } }), res);
    expect(res._status).toBe(400);
  });

  it('retipa el label de un segmento y persiste segments completo', async () => {
    sqlResponses.push([{ segments }]); // SELECT
    sqlResponses.push({ count: 1 }); // UPDATE
    const res = makeRes();
    await handler(makeReq({ body: { segmentIndex: 1, label: 'pre-coro' } }), res);
    expect(res._status).toBe(200);
    expect(res._body.segments[1]).toEqual({ label: 'pre-coro', startMs: 2000, endMs: 8000 });
    expect(res._body.segments[0]).toEqual(segments[0]); // no toca los demas
    const updateCall = sqlCalls.find((c) => c.text.includes('UPDATE song_structure'));
    expect(updateCall.values[0][1].label).toBe('pre-coro');
  });

  it('ajusta bordes validos (sin solape) y persiste', async () => {
    sqlResponses.push([{ segments }]);
    sqlResponses.push({ count: 1 });
    const res = makeRes();
    await handler(makeReq({ body: { segmentIndex: 1, startMs: 2500, endMs: 7500 } }), res);
    expect(res._status).toBe(200);
    expect(res._body.segments[1]).toEqual({ label: 'verso', startMs: 2500, endMs: 7500 });
  });
});
