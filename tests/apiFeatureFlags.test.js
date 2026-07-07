import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}));
vi.mock('postgres', () => ({
  default: () => Object.assign(() => Promise.resolve([]), { json: (v) => v }),
}));

// El catalogo/asignaciones ahora vienen de flagsCache (cache modulo-scope), no de
// la query `sql` que recibe requireFlag como parametro. Se mockea directo para
// controlar el escenario de cada test sin depender del TTL de la cache real.
const mockGetFlagsCatalog = vi.fn();
vi.mock('../api/_lib/flagsCache.js', () => ({
  getFlagsCatalog: mockGetFlagsCatalog,
  invalidateFlags: vi.fn(),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

const { requireFlag } = await import('../api/_lib/auth.js');

function reqWith(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

describe('requireFlag', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockGetFlagsCatalog.mockReset();
  });

  it('lanza 401 si no hay usuario', async () => {
    const sql = () => Promise.resolve([]);
    await expect(requireFlag({ headers: {} }, sql, 'voz_tono')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('lanza 403 si el usuario no tiene el flag', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'x@y.com' } },
      error: null,
    });
    // sql devuelve [] para el perfil; flagsCache sin catálogo ni asignaciones → sin flags
    const sql = () => Promise.resolve([]);
    mockGetFlagsCatalog.mockResolvedValueOnce({ catalog: [], assignments: [] });
    await expect(requireFlag(reqWith('ok'), sql, 'voz_tono')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('pasa si el flag está global', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'x@y.com' } },
      error: null,
    });
    // sql solo resuelve el perfil (username); catálogo/asignaciones vienen de flagsCache.
    const sql = () => Promise.resolve([{ username: 'someuser' }]);
    mockGetFlagsCatalog.mockResolvedValueOnce({
      catalog: [{ key: 'voz_tono', enabledGlobal: true }],
      assignments: [],
    });
    await expect(requireFlag(reqWith('ok'), sql, 'voz_tono')).resolves.toMatchObject({ id: 'u1' });
  });
});
