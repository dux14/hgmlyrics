import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}));
vi.mock('postgres', () => ({
  default: () => Object.assign(() => Promise.resolve([]), { json: (v) => v }),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

const { requireFlag } = await import('../api/_lib/auth.js');

function reqWith(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

describe('requireFlag', () => {
  beforeEach(() => mockGetUser.mockReset());

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
    // sql devuelve [] para catálogo y asignaciones → sin flags
    const sql = () => Promise.resolve([]);
    await expect(requireFlag(reqWith('ok'), sql, 'voz_tono')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('pasa si el flag está global', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'x@y.com' } },
      error: null,
    });
    // Primera llamada sql = perfil (username), segunda = catálogo, tercera = asignaciones.
    const calls = [
      [{ username: 'someuser' }], // profile lookup
      [{ key: 'voz_tono', enabledGlobal: true }], // catalog
      [], // assignments
    ];
    let i = 0;
    const sql = () => Promise.resolve(calls[i++] ?? []);
    await expect(requireFlag(reqWith('ok'), sql, 'voz_tono')).resolves.toMatchObject({ id: 'u1' });
  });
});
