import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// authStore importa estos módulos dinámicamente solo dentro del flujo de
// SIGNED_OUT (invalidación de caches por-usuario); los mockeamos para no
// arrastrar sus dependencias reales (incluido el ciclo profileCache→authStore).
vi.mock('./prefetch.js', () => ({ invalidatePrefix: vi.fn() }));
vi.mock('./profileCache.js', () => ({ invalidateFriends: vi.fn() }));
vi.mock('./weeklyWords.js', () => ({ invalidateWeeklyWords: vi.fn() }));
vi.mock('./searchUsersCache.js', () => ({ clearSearchUsersCache: vi.fn() }));

vi.mock('../router.js', () => ({
  refresh: vi.fn(),
  getCurrentPath: vi.fn(() => '/perfil'),
}));

vi.mock('./supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      refreshSession: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const AUTH_STORAGE_KEY = 'sb-omntufksfhezqtqgmhlp-auth-token';
const PROFILE_CACHE_KEY = 'hkn-profile-cache';

function makeSession(overrides = {}) {
  return { access_token: 'tok', refresh_token: 'rtok', user: { id: 'u1' }, ...overrides };
}

async function loadStore() {
  vi.resetModules();
  const store = await import('./authStore.js');
  const { supabase } = await import('./supabase.js');
  return { store, supabase };
}

// El listener 'online' real de globalThis persiste entre tests (distintas
// instancias de módulo via vi.resetModules() no lo desregistran solas), lo
// que contaminaría el conteo de llamadas de tests siguientes. Interceptamos
// add/removeEventListener para 'online' con un registro propio por test, en
// vez de depender del bus de eventos real de jsdom.
let onlineHandlers = [];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  onlineHandlers = [];
  vi.stubGlobal('navigator', { onLine: true });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ profile: { username: 'ana' }, flags: ['f1'] }),
  });
  vi.spyOn(globalThis, 'addEventListener').mockImplementation((type, fn) => {
    if (type === 'online') onlineHandlers.push(fn);
  });
  vi.spyOn(globalThis, 'removeEventListener').mockImplementation((type, fn) => {
    if (type === 'online') onlineHandlers = onlineHandlers.filter((h) => h !== fn);
  });
});

function fireOnline() {
  onlineHandlers.forEach((fn) => fn());
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('initAuthStore — boot normal', () => {
  it('con sesión activa hace fetch de perfil y queda autenticado', async () => {
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});

    await store.initAuthStore();

    expect(store.isAuthenticated()).toBe(true);
    expect(store.getProfile()).toEqual({ username: 'ana' });
  });

  it('sin sesión y sin nada persistido, no autentica', async () => {
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});

    await store.initAuthStore();

    expect(store.isAuthenticated()).toBe(false);
  });
});

describe('initAuthStore — restauracion optimista (T1)', () => {
  it('getSession() null pero con refresh_token persistido entra en pendingSession y queda autenticado', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});
    supabase.auth.refreshSession.mockResolvedValue({});

    await store.initAuthStore();

    expect(store.isAuthenticated()).toBe(true);
  });

  it('sesión persistida corrupta (JSON inválido) no activa pendingSession', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, '{not json');
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});

    await store.initAuthStore();

    expect(store.isAuthenticated()).toBe(false);
  });

  it('sesión persistida sin refresh_token no activa pendingSession', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: 'tok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});

    await store.initAuthStore();

    expect(store.isAuthenticated()).toBe(false);
  });

  it('en modo pending restaura profile/flags desde el cache en vez de hacer fetch', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ profile: { username: 'cached' }, flags: ['cached-flag'] })
    );
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});
    supabase.auth.refreshSession.mockResolvedValue({});

    await store.initAuthStore();

    expect(store.getProfile()).toEqual({ username: 'cached' });
    expect(store.isFeatureEnabled('cached-flag')).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refreshProfile() exitoso cachea profile+flags en localStorage', async () => {
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});

    await store.initAuthStore();

    const cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY));
    expect(cached).toEqual({ profile: { username: 'ana' }, flags: ['f1'] });
  });

  it('reintenta refreshSession en background con backoff mientras pending', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});
    supabase.auth.refreshSession.mockResolvedValue({});

    await store.initAuthStore();
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(2);
  });

  it('refreshSession() exitoso detiene el loop de retry sin esperar TOKEN_REFRESHED', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    // onAuthStateChange nunca dispara TOKEN_REFRESHED en este test: el éxito
    // debe resolverse solo con la respuesta de refreshSession() (issue 2).
    supabase.auth.onAuthStateChange.mockImplementation(() => {});
    const rotated = makeSession({ access_token: 'tok-rotado' });
    supabase.auth.refreshSession.mockResolvedValue({ data: { session: rotated }, error: null });

    await store.initAuthStore();
    expect(store.isAuthenticated()).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(store.getSession()).toEqual(rotated);
    expect(store.isAuthenticated()).toBe(true);

    // Si quedara un timer redundante programado, avanzar el siguiente escalón
    // de backoff (5s) dispararía una segunda llamada. No debe pasar.
    await vi.advanceTimersByTimeAsync(5000);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('listener online dispara refreshSession de inmediato y se remueve al salir de pending', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    let handler;
    supabase.auth.onAuthStateChange.mockImplementation((fn) => {
      handler = fn;
    });
    supabase.auth.refreshSession.mockResolvedValue({});

    await store.initAuthStore();
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    expect(onlineHandlers.length).toBe(1);

    // Antes de que venza el primer backoff (2s), llega el evento 'online':
    // debe reintentar ya, sin esperar el timer en curso.
    fireOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);

    // Sale de pendingSession (TOKEN_REFRESHED) → el listener debe quedar removido.
    await handler('TOKEN_REFRESHED', makeSession());
    expect(store.isAuthenticated()).toBe(true);
    expect(onlineHandlers.length).toBe(0);

    // Un 'online' posterior a salir de pending no debe llamar refreshSession de nuevo
    // (no hay handler activo: el array ya está vacío, fireOnline() es un no-op).
    fireOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('TOKEN_REFRESHED via onAuthStateChange limpia pendingSession', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    let handler;
    supabase.auth.onAuthStateChange.mockImplementation((fn) => {
      handler = fn;
    });
    supabase.auth.refreshSession.mockResolvedValue({});

    await store.initAuthStore();
    expect(store.isAuthenticated()).toBe(true);

    await handler('TOKEN_REFRESHED', makeSession());

    expect(store.getSession()).toEqual(makeSession());
    expect(store.isAuthenticated()).toBe(true);
  });

  it('SIGNED_OUT definitivo tras pendingSession limpia el cache de perfil', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ profile: { username: 'cached' }, flags: [] })
    );
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    let handler;
    supabase.auth.onAuthStateChange.mockImplementation((fn) => {
      handler = fn;
    });

    await store.initAuthStore();
    // El recheck de T2 corre en SIGNED_OUT: getSession vuelve a null → definitivo.
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    const p = handler('SIGNED_OUT', null);
    await vi.advanceTimersByTimeAsync(1500);
    await p;

    expect(store.isAuthenticated()).toBe(false);
    expect(localStorage.getItem(PROFILE_CACHE_KEY)).toBeNull();
  });
});

describe('onAuthStateChange — SIGNED_OUT resiliente (T2)', () => {
  async function bootWithSession() {
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: makeSession() } });
    let handler;
    supabase.auth.onAuthStateChange.mockImplementation((fn) => {
      handler = fn;
    });
    await store.initAuthStore();
    return { store, supabase, handler };
  }

  it('recupera sesion si el recheck encuentra una sesion rotada nueva en storage', async () => {
    vi.useFakeTimers();
    const { store, supabase, handler } = await bootWithSession();
    const rotated = makeSession({ access_token: 'tok2' });
    supabase.auth.getSession.mockResolvedValue({ data: { session: rotated } });

    const p = handler('SIGNED_OUT', null);
    await vi.advanceTimersByTimeAsync(1500);
    await p;

    expect(store.getSession()).toEqual(rotated);
    expect(store.isAuthenticated()).toBe(true);
    const { refresh } = await import('../router.js');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sin sesion tras el recheck, ejecuta el flujo de kick (refresh + invalidacion)', async () => {
    vi.useFakeTimers();
    const { store, supabase, handler } = await bootWithSession();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    const p = handler('SIGNED_OUT', null);
    await vi.advanceTimersByTimeAsync(1500);
    await p;

    expect(store.isAuthenticated()).toBe(false);
    const { refresh } = await import('../router.js');
    expect(refresh).toHaveBeenCalled();
  });

  it('no reintenta el recheck dos veces en el mismo episodio (evita loop)', async () => {
    vi.useFakeTimers();
    const { store, supabase, handler } = await bootWithSession();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    const p1 = handler('SIGNED_OUT', null);
    await vi.advanceTimersByTimeAsync(1500);
    await p1;
    const callsAfterFirst = supabase.auth.getSession.mock.calls.length;

    await handler('SIGNED_OUT', null);

    // El segundo SIGNED_OUT no debe disparar otro recheck (getSession no crece).
    expect(supabase.auth.getSession.mock.calls.length).toBe(callsAfterFirst);
    expect(store.isAuthenticated()).toBe(false);
  });

  it('offline: no intenta el recheck y ejecuta el kick directo', async () => {
    const { store, supabase, handler } = await bootWithSession();
    vi.stubGlobal('navigator', { onLine: false });
    const callsBefore = supabase.auth.getSession.mock.calls.length;

    await handler('SIGNED_OUT', null);

    expect(supabase.auth.getSession.mock.calls.length).toBe(callsBefore);
    expect(store.isAuthenticated()).toBe(false);
  });
});

describe('signOut', () => {
  it('limpia el cache de perfil', async () => {
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ profile: { username: 'ana' }, flags: [] })
    );
    const { store, supabase } = await loadStore();
    supabase.auth.signOut.mockResolvedValue({});

    await store.signOut();

    expect(localStorage.getItem(PROFILE_CACHE_KEY)).toBeNull();
  });
});
