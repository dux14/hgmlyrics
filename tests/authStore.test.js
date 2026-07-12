import { describe, it, expect, vi, beforeEach } from 'vitest';

let authStateChangeHandler = null;
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn((fn) => {
  authStateChangeHandler = fn;
  return { data: { subscription: { unsubscribe: () => {} } } };
});
const mockSignInWithOAuth = vi.fn();
const mockSignInWithOtp = vi.fn();
const mockSignOut = vi.fn();

vi.mock('../src/lib/supabase.js', () => ({
  AUTH_STORAGE_KEY: 'sb-test-ref-auth-token',
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithOAuth: mockSignInWithOAuth,
      signInWithOtp: mockSignInWithOtp,
      signOut: mockSignOut,
    },
  },
}));

const {
  initAuthStore,
  subscribe,
  getProfile,
  isAuthenticated,
  isAdmin,
  needsOnboarding,
  signInWithGoogle,
  signInWithMagicLink,
  signOut,
  isFeatureEnabled,
  __setFlagsForTest,
} = await import('../src/lib/authStore.js');

describe('authStore', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    authStateChangeHandler = null;
    globalThis.fetch = vi.fn();
  });

  it('initAuthStore with no session leaves authenticated=false', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    await initAuthStore();
    expect(isAuthenticated()).toBe(false);
    expect(getProfile()).toBe(null);
  });

  it('boot offline con sesion valida restaura perfil/flags del snapshot local', async () => {
    localStorage.setItem(
      'hkn-profile-cache',
      JSON.stringify({ profile: { id: 'u1', isAdmin: true }, flags: ['voz_tono'] }),
    );
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok', user: { id: 'u1' } } },
    });
    globalThis.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await initAuthStore();
    expect(isAdmin()).toBe(true);
    expect(isFeatureEnabled('voz_tono')).toBe(true);
    localStorage.removeItem('hkn-profile-cache');
  });

  it('initAuthStore with session fetches profile via /api/auth/me', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } });
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: 'u1' }, profile: { username: 'juan', isAdmin: false } }),
    });
    await initAuthStore();
    expect(isAuthenticated()).toBe(true);
    expect(getProfile()).toEqual({ username: 'juan', isAdmin: false });
    expect(needsOnboarding()).toBe(false);
  });

  it('needsOnboarding=true when profile.username is null', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } });
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profile: { username: null, isAdmin: false } }),
    });
    await initAuthStore();
    expect(needsOnboarding()).toBe(true);
  });

  it('isAdmin reflects profile.isAdmin', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } });
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profile: { username: 'admin1', isAdmin: true } }),
    });
    await initAuthStore();
    expect(isAdmin()).toBe(true);
  });

  it('subscribers notified on SIGNED_OUT (logout propio, sin recheck)', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } });
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profile: { username: 'x', isAdmin: false } }),
    });
    await initAuthStore();
    const spy = vi.fn();
    subscribe(spy);

    // signOut() marca el SIGNED_OUT que sigue como propio: el handler debe
    // saltarse el recheck de T2 por completo (sin timers reales de 1.5s) e
    // ir directo al kick. Si esto no funcionara, el segundo getSession()
    // (sin mock encolado) lanzaría y el test tardaría ~1.5s reales en CI.
    await signOut();
    await authStateChangeHandler('SIGNED_OUT', null);

    expect(spy).toHaveBeenCalledWith({ session: null, profile: null, pending: false });
    expect(isAuthenticated()).toBe(false);
  });

  it('signInWithGoogle delegates to supabase.auth.signInWithOAuth', async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ data: {}, error: null });
    await signInWithGoogle();
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: expect.stringContaining('/#/auth/callback') },
    });
  });

  it('signInWithMagicLink delegates to supabase.auth.signInWithOtp', async () => {
    mockSignInWithOtp.mockResolvedValueOnce({ data: {}, error: null });
    await signInWithMagicLink('x@y.com');
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'x@y.com',
      options: { emailRedirectTo: expect.stringContaining('/#/auth/callback') },
    });
  });

  it('signOut delegates to supabase.auth.signOut', async () => {
    mockSignOut.mockResolvedValueOnce({ error: null });
    await signOut();
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe('isFeatureEnabled', () => {
  it('devuelve false cuando no hay flags', () => {
    __setFlagsForTest([]);
    expect(isFeatureEnabled('voz_tono')).toBe(false);
  });
  it('devuelve true cuando el flag está presente', () => {
    __setFlagsForTest(['voz_tono']);
    expect(isFeatureEnabled('voz_tono')).toBe(true);
    expect(isFeatureEnabled('flag_inexistente')).toBe(false);
  });
});
