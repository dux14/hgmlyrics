/**
 * apiSocialSearch.test.js — SEC-21: escapado de comodines LIKE en búsqueda social.
 *
 * Verifica que los metacaracteres LIKE de Postgres (%, _, \) se escapen
 * correctamente antes de construir el patrón, sin romper búsquedas normales.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock de supabase (requireUser lo usa internamente) ───────────────────────
const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

// ── Mock de sql: captura los valores interpolados ────────────────────────────
const sqlValues = [];
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  sqlValues.push(...values);
  return Promise.resolve([]);
}
sqlMock.json = (v) => v;
vi.mock('postgres', () => ({ default: () => sqlMock }));

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

// Importar handler DESPUÉS de establecer mocks y env
const handler = (await import('../api/social/search.js')).default;

function makeReq(q, scope) {
  const params = new URLSearchParams({ q });
  if (scope) params.set('scope', scope);
  return {
    method: 'GET',
    headers: { authorization: 'Bearer tok' },
    query: Object.fromEntries(params),
  };
}

function makeRes() {
  let statusCode = null;
  let body = null;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      body = data;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

describe('GET /api/social/search (SEC-21 — escapado LIKE)', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    sqlValues.length = 0;
    // Usuario autenticado válido
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'viewer-1', email: 'viewer@test.com' } },
      error: null,
    });
  });

  it('escapa % en el término — "50%" no actúa como comodín LIKE', async () => {
    await handler(makeReq('50%'), makeRes());

    // El patrón WHERE (envuelve con %) debe tener \% escapado
    const patternWhere = sqlValues.find((v) => typeof v === 'string' && v.startsWith('%'));
    expect(patternWhere).toBe('%50\\%%');

    // El patrón ORDER BY prefix: no empieza con %, tiene el backslash de escape
    // (se diferencia de q='50%' porque contiene \% y no empieza con %)
    const prefixPattern = sqlValues.find(
      (v) => typeof v === 'string' && v.endsWith('%') && !v.startsWith('%') && v.includes('\\%'),
    );
    expect(prefixPattern).toBe('50\\%%');
  });

  it('escapa _ en el término — "a_b" no actúa como comodín de un carácter', async () => {
    await handler(makeReq('a_b'), makeRes());

    const patternWhere = sqlValues.find((v) => typeof v === 'string' && v.startsWith('%'));
    expect(patternWhere).toBe('%a\\_b%');

    const prefixPattern = sqlValues.find(
      (v) => typeof v === 'string' && v.endsWith('%') && !v.startsWith('%') && v.includes('\\_'),
    );
    expect(prefixPattern).toBe('a\\_b%');
  });

  it('escapa \\ en el término — "\\" no confunde el carácter de escape de Postgres', async () => {
    await handler(makeReq('a\\b'), makeRes());

    const patternWhere = sqlValues.find((v) => typeof v === 'string' && v.startsWith('%'));
    expect(patternWhere).toBe('%a\\\\b%');
  });

  it('búsqueda normal "ana" no altera el patrón — debe seguir encontrando Mariana, Ana, etc.', async () => {
    await handler(makeReq('ana'), makeRes());

    const patternWhere = sqlValues.find((v) => typeof v === 'string' && v.startsWith('%'));
    expect(patternWhere).toBe('%ana%');

    // El patrón ORDER BY prefix: termina con % pero no tiene backslash (no había metacaracteres)
    const prefixPattern = sqlValues.find(
      (v) => typeof v === 'string' && v.endsWith('%') && !v.startsWith('%') && !v.includes('\\'),
    );
    expect(prefixPattern).toBe('ana%');
  });

  it('término demasiado corto (< 2 chars) devuelve results vacíos sin llamar a sql', async () => {
    const res = makeRes();
    await handler(makeReq('a'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ results: [] });
    // No debe haber valores capturados (sql no se llamó)
    expect(sqlValues.length).toBe(0);
  });
});
