/**
 * apiVitalsCleanup.test.js — TDD para GET /api/vitals/cleanup (cron job).
 * Purga filas de web_vitals más viejas que 30 días. Mismo patrón de auth
 * fail-closed que tests/apiStemsCleanup.test.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRes } from './helpers/makeRes.js';

const responses = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  return Promise.resolve(responses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('postgres', () => ({ default: () => sqlMock }));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

const handler = (await import('../api/vitals/cleanup.js')).default;

function makeReq(over = {}) {
  return { method: 'GET', headers: {}, query: {}, body: {}, ...over };
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  responses.length = 0;
  process.env.CRON_SECRET = 'supersecret';
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('GET /api/vitals/cleanup', () => {
  it('401 sin Authorization header', async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(401);
  });

  it('401 con secreto incorrecto', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer incorrecto' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('401 fail-closed si CRON_SECRET no está configurado', async () => {
    delete process.env.CRON_SECRET;
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer lo-que-sea' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('200 con secreto correcto: borra filas viejas y reporta el conteo', async () => {
    responses.push([{ id: 1 }, { id: 2 }]); // DELETE ... RETURNING id
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ deleted: 2 });
  });

  it('405 si el método no es GET', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });
});
