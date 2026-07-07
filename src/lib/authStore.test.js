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

const AUTH_STORAGE_KEY = 'sb-omntufksfhezqtqgmhlp-auth-token';

vi.mock('./supabase.js', () => ({
  // Mismo valor que exporta el supabase.js real para VITE_SUPABASE_URL de
  // .env.local: authStore.js debe leer ESTA constante, no re-derivarla.
  AUTH_STORAGE_KEY: 'sb-omntufksfhezqtqgmhlp-auth-token',
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      refreshSession: vi.fn(),
      signOut: vi.fn(),
      verifyOtp: vi.fn(),
    },
  },
}));
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
    expect(store.isPendingSession()).toBe(false);
  });

  it('notify() incluye pending en el snapshot para que la UI pueda distinguir el estado optimista', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    let handler;
    supabase.auth.onAuthStateChange.mockImplementation((fn) => {
      handler = fn;
    });
    const spy = vi.fn();

    await store.initAuthStore();
    expect(store.isPendingSession()).toBe(true);
    store.subscribe(spy);

    // TOKEN_REFRESHED saca de pendingSession vía clearPendingSession(): el
    // notify() resultante debe reportar pending: false.
    await handler('TOKEN_REFRESHED', makeSession());

    expect(spy).toHaveBeenCalledWith({
      session: makeSession(),
      profile: { username: 'ana' },
      pending: false,
    });
  });
});

describe('refreshProfile — fallo transitorio vs. definitivo', () => {
  it('fetch que lanza (fallo de red) conserva el ultimo profile/flags en memoria', async () => {
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});
    // El primer refreshProfile() del boot es exitoso y deja un profile "bueno".
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profile: { username: 'restaurado' }, flags: ['f1'] }),
    });

    await store.initAuthStore();
    expect(store.getProfile()).toEqual({ username: 'restaurado' });

    // Un refresh posterior falla por RED (el fetch lanza, el server nunca habló).
    globalThis.fetch.mockRejectedValueOnce(new Error('network down'));
    const ok = await store.refreshProfile();

    expect(ok).toBe(false);
    expect(store.getProfile()).toEqual({ username: 'restaurado' });
    expect(store.isFeatureEnabled('f1')).toBe(true);
  });

  it('respuesta non-ok del server (401/403/500) nulea el profile como hoy', async () => {
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: makeSession() } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profile: { username: 'restaurado' }, flags: ['f1'] }),
    });

    await store.initAuthStore();
    expect(store.getProfile()).toEqual({ username: 'restaurado' });

    // El server SI respondio (401: token revocado) — acá sí queremos nulear.
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const ok = await store.refreshProfile();

    expect(ok).toBe(false);
    expect(store.getProfile()).toBeNull();
    expect(store.isFeatureEnabled('f1')).toBe(false);
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
      JSON.stringify({ profile: { username: 'cached' }, flags: ['cached-flag'] }),
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

  it('online mientras un intento por backoff sigue en vuelo no dispara un segundo refreshSession', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabase.auth.onAuthStateChange.mockImplementation(() => {});
    let resolveRefresh;
    supabase.auth.refreshSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    await store.initAuthStore();

    // Dispara el intento programado por backoff (2s); queda en vuelo.
    await vi.advanceTimersByTimeAsync(2000);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);

    // 'online' llega mientras ese intento sigue esperando refreshSession():
    // el guard in-flight debe hacer no-op esta segunda entrada.
    fireOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);

    // El intento en vuelo termina fallando: recién ahí reprograma un unico timer.
    resolveRefresh({ data: { session: null }, error: new Error('still offline') });
    await vi.advanceTimersByTimeAsync(0);

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

  it('TOKEN_REFRESHED concurrente con attemptRefresh no duplica fetch de perfil ni notify', async () => {
    // auth-js 2.106 usa BroadcastChannel multi-pestaña por defecto: un
    // TOKEN_REFRESHED puede llegar por ese camino async ANTES de que resuelva
    // el refreshSession() que attemptRefresh ya está esperando. Ambos caminos
    // convergen en clearPendingSession(), que debe ser idempotente.
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    let handler;
    supabase.auth.onAuthStateChange.mockImplementation((fn) => {
      handler = fn;
    });
    let resolveRefresh;
    supabase.auth.refreshSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    await store.initAuthStore();
    const notifySpy = vi.fn();
    store.subscribe(notifySpy);

    // Primer intento de attemptRefresh (backoff a los 2s); queda colgado
    // esperando la respuesta de refreshSession().
    await vi.advanceTimersByTimeAsync(2000);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Llega TOKEN_REFRESHED por el otro camino (broadcast) antes de que la
    // promesa local de refreshSession() resuelva.
    const rotated = makeSession({ access_token: 'tok-broadcast' });
    await handler('TOKEN_REFRESHED', rotated);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(store.getSession()).toEqual(rotated);

    // Ahora resuelve el refreshSession() local con su propia sesión:
    // attemptRefresh debe entrar al guard de clearPendingSession (ya no hay
    // pendingSession) y no repetir fetch/notify.
    resolveRefresh({ data: { session: makeSession({ access_token: 'tok-local' }) }, error: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(store.getSession()).toEqual(rotated);
  });

  it('INITIAL_SESSION(null) durante pendingSession no toca nada (auth-js la emite siempre tras boot)', async () => {
    // GoTrueClient._emitInitialSession dispara SIEMPRE un INITIAL_SESSION con
    // la sesión actual justo después de registrar el listener. En boot
    // offline con token expirado esa sesión es null y llega milisegundos
    // después de que initAuthStore ya armó pendingSession — no debe
    // interpretarse como un logout.
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ profile: { username: 'cached' }, flags: ['cached-flag'] }),
    );
    const { store, supabase } = await loadStore();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    let handler;
    supabase.auth.onAuthStateChange.mockImplementation((fn) => {
      handler = fn;
    });
    supabase.auth.refreshSession.mockResolvedValue({});

    await store.initAuthStore();
    expect(store.isPendingSession()).toBe(true);
    expect(store.isAuthenticated()).toBe(true);

    await handler('INITIAL_SESSION', null);

    expect(store.isPendingSession()).toBe(true);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getProfile()).toEqual({ username: 'cached' });
    expect(localStorage.getItem(PROFILE_CACHE_KEY)).not.toBeNull();
    // No debe haber disparado el flujo de kick: getSession solo se llamó una
    // vez, la del boot.
    expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it('SIGNED_OUT definitivo tras pendingSession limpia el cache de perfil', async () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'rtok' }));
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ profile: { username: 'cached' }, flags: [] }),
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

  it('SIGNED_OUT no intencional: el callback resuelve sin llamar getSession() en el mismo tick (evita el deadlock de auth-js)', async () => {
    // auth-js sostiene un lock interno durante signOut(): _notifyAllSubscribers
    // hace `await Promise.all(callbacks)` ANTES de resolver. Si este callback
    // llamara (y esperara) a getSession() antes de retornar, esa llamada
    // reintentaría el mismo lock y quedaría esperando a que signOut()
    // termine -> deadlock circular, el logout se cuelga para siempre.
    vi.useFakeTimers();
    const { store, supabase, handler } = await bootWithSession();
    supabase.auth.getSession.mockClear();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    await handler('SIGNED_OUT', null);
    // El callback ya resolvió: NO debe haber llamado getSession() todavía.
    expect(supabase.auth.getSession).not.toHaveBeenCalled();

    // El recheck corre diferido, en un macrotask (setTimeout) aparte.
    await vi.advanceTimersByTimeAsync(1500);
    expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
    expect(store.isAuthenticated()).toBe(false);
  });

  it('signOut() propio salta el recheck por completo y va directo al kick, sin llamar getSession() ni esperar', async () => {
    vi.useFakeTimers();
    const { store, supabase, handler } = await bootWithSession();
    supabase.auth.signOut.mockResolvedValue({});
    supabase.auth.getSession.mockClear();

    await store.signOut();
    await handler('SIGNED_OUT', null);

    // Nada de recheck: ni siquiera se volvió a llamar getSession().
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    const { refresh } = await import('../router.js');
    expect(refresh).toHaveBeenCalled();
    expect(store.isAuthenticated()).toBe(false);

    // Avanzar el tiempo no debe disparar nada adicional (no quedó nada
    // diferido programado).
    await vi.advanceTimersByTimeAsync(5000);
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it('recheck exitoso resetea signOutRecheckAttempted: un episodio nuevo puede volver a intentarlo', async () => {
    vi.useFakeTimers();
    const { store, supabase, handler } = await bootWithSession();
    const rotated = makeSession({ access_token: 'tok-rotado-1' });
    supabase.auth.getSession.mockResolvedValue({ data: { session: rotated } });

    // Episodio 1: se recupera con éxito.
    await handler('SIGNED_OUT', null);
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getSession()).toEqual(rotated);
    expect(store.isAuthenticated()).toBe(true);

    // Episodio 2, independiente: otra rotación falla en esta pestaña. Si el
    // flag no se hubiera reseteado tras la recuperación exitosa, este
    // SIGNED_OUT caería directo al kick sin intentar el recheck.
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    const callsBefore = supabase.auth.getSession.mock.calls.length;

    await handler('SIGNED_OUT', null);
    await vi.advanceTimersByTimeAsync(1500);

    expect(supabase.auth.getSession.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(store.isAuthenticated()).toBe(false);
  });
});

describe('verifyEmailOtp', () => {
  it('llama a supabase.auth.verifyOtp con email, token y type email', async () => {
    const { store, supabase } = await loadStore();
    supabase.auth.verifyOtp.mockResolvedValue({ data: { session: makeSession() }, error: null });

    const result = await store.verifyEmailOtp('ana@correo.com', '12345678');

    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'ana@correo.com',
      token: '12345678',
      type: 'email',
    });
    expect(result).toEqual({ data: { session: makeSession() }, error: null });
  });

  it('propaga el error cuando verifyOtp falla', async () => {
    const { store, supabase } = await loadStore();
    const error = new Error('token invalido');
    supabase.auth.verifyOtp.mockResolvedValue({ data: { session: null }, error });

    const result = await store.verifyEmailOtp('ana@correo.com', '00000000');

    expect(result.error).toBe(error);
  });
});

describe('signOut', () => {
  it('limpia el cache de perfil', async () => {
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ profile: { username: 'ana' }, flags: [] }),
    );
    const { store, supabase } = await loadStore();
    supabase.auth.signOut.mockResolvedValue({});

    await store.signOut();

    expect(localStorage.getItem(PROFILE_CACHE_KEY)).toBeNull();
  });
});

describe('AUTH_STORAGE_KEY — fuente unica compartida con supabase.js', () => {
  it('lee la key persistida bajo la AUTH_STORAGE_KEY que exporta supabase.js, no una re-derivada localmente', async () => {
    // Sobreescribe el mock de supabase.js con una AUTH_STORAGE_KEY distinta a
    // la convención `sb-<ref>-auth-token`: si authStore.js todavía la
    // re-derivara por su cuenta (regex local), este test fallaría porque
    // buscaría la sesión bajo la key vieja en vez de la key custom.
    try {
      vi.doMock('./supabase.js', () => ({
        AUTH_STORAGE_KEY: 'custom-storage-key-no-estandar',
        supabase: {
          auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
            onAuthStateChange: vi.fn(),
            exchangeCodeForSession: vi.fn(),
            refreshSession: vi.fn().mockResolvedValue({}),
            signOut: vi.fn(),
          },
        },
      }));
      vi.resetModules();
      localStorage.setItem(
        'custom-storage-key-no-estandar',
        JSON.stringify({ refresh_token: 'rtok' }),
      );
      const store = await import('./authStore.js');

      await store.initAuthStore();

      expect(store.isAuthenticated()).toBe(true);
    } finally {
      vi.doUnmock('./supabase.js');
      vi.resetModules();
    }
  });
});
