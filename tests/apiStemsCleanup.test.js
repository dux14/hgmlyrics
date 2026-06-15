/**
 * apiStemsCleanup.test.js — TDD para GET /api/stems/cleanup (cron job)
 * Verifica que el auth check sea fail-closed cuando CRON_SECRET no está definido.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock de storage ───────────────────────────────────────────────────────────
const mockDeleteStemsPrefix = vi.fn();
vi.mock('../api/_lib/storage.js', () => ({
  deleteStemsPrefix: mockDeleteStemsPrefix,
}));

// ── Mock de sql ───────────────────────────────────────────────────────────────
const sqlResponses = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
sqlMock.array = vi.fn((arr) => ({ __pgArray: arr }));
vi.mock('postgres', () => ({ default: () => sqlMock }));

// ── Env vars mínimas ──────────────────────────────────────────────────────────
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
process.env.DATABASE_URL = 'postgresql://test';

// Importar handler DESPUÉS de los mocks
const handler = (await import('../api/stems/cleanup.js')).default;

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRes() {
  return {
    statusCode: 200,
    body: null,
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

function makeReq(over = {}) {
  return {
    method: 'GET',
    headers: {},
    query: {},
    body: {},
    ...over,
  };
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  sqlResponses.length = 0;
  mockDeleteStemsPrefix.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  // Restaurar CRON_SECRET al valor original del entorno
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  }
});

describe('GET /api/stems/cleanup — auth fail-closed', () => {
  it('SEC-02: CRON_SECRET ausente + header "Bearer undefined" → 401 y no ejecuta borrado', async () => {
    delete process.env.CRON_SECRET;

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer undefined' } }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toBeTruthy();
    expect(mockDeleteStemsPrefix).not.toHaveBeenCalled();
  });

  it('SEC-02: CRON_SECRET ausente + header vacío → 401 y no ejecuta borrado', async () => {
    delete process.env.CRON_SECRET;

    const res = makeRes();
    await handler(makeReq({ headers: {} }), res);

    expect(res.statusCode).toBe(401);
    expect(mockDeleteStemsPrefix).not.toHaveBeenCalled();
  });

  it('CRON_SECRET definido + header equivocado → 401 y no ejecuta borrado', async () => {
    process.env.CRON_SECRET = 'supersecret';

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer wrong-token' } }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toBeTruthy();
    expect(mockDeleteStemsPrefix).not.toHaveBeenCalled();
  });

  it('CRON_SECRET definido + header correcto → procede (200) y lógica de limpieza se invoca', async () => {
    process.env.CRON_SECRET = 'supersecret';

    // Respuestas vacías para las 5 queries SQL del cron
    sqlResponses.push([]); // expired
    sqlResponses.push([]); // zombies
    sqlResponses.push([]); // abandoned
    sqlResponses.push([]); // orphanStorage
    sqlResponses.push([]); // expiredLists

    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer supersecret' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      expired: 0,
      zombies: 0,
      abandoned: 0,
      failedStorage: 0,
      expiredLists: 0,
    });
  });
});
