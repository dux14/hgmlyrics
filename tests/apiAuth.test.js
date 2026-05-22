import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @supabase/supabase-js BEFORE importing the helper
const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

// Mock postgres
vi.mock('postgres', () => ({
  default: () => Object.assign(() => Promise.resolve([]), { json: (v) => v }),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

const { requireUser, requireAdmin } = await import('../api/_lib/auth.js');

function reqWith(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

describe('requireUser', () => {
  beforeEach(() => mockGetUser.mockReset());

  it('throws 401 when no Authorization header', async () => {
    await expect(requireUser({ headers: {} })).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 when token invalid', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'bad' } });
    await expect(requireUser(reqWith('xxx'))).rejects.toMatchObject({ status: 401 });
  });

  it('returns user on valid token', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'x@y.com' } },
      error: null,
    });
    await expect(requireUser(reqWith('ok'))).resolves.toEqual({ id: 'u1', email: 'x@y.com' });
  });
});

describe('requireAdmin', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    delete process.env.ADMIN_EMAILS;
  });

  it('passes when email is in ADMIN_EMAILS (env-only)', async () => {
    process.env.ADMIN_EMAILS = 'x@y.com, other@z.com';
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'X@Y.com' } },
      error: null,
    });
    const sql = () => Promise.resolve([]); // not called when env hit
    await expect(requireAdmin(reqWith('ok'), sql)).resolves.toMatchObject({ id: 'u1' });
  });

  it('falls back to profiles.is_admin when not in env', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u2', email: 'a@b.com' } },
      error: null,
    });
    const sql = () => Promise.resolve([{ is_admin: true }]);
    await expect(requireAdmin(reqWith('ok'), sql)).resolves.toMatchObject({ id: 'u2' });
  });

  it('throws 403 when not in env and profiles.is_admin=false', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'u3', email: 'a@b.com' } },
      error: null,
    });
    const sql = () => Promise.resolve([{ is_admin: false }]);
    await expect(requireAdmin(reqWith('ok'), sql)).rejects.toMatchObject({ status: 403 });
  });
});
