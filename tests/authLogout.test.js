// tests/authLogout.test.js
/**
 * Regresión del bug: logout que a veces aterriza en una ruta protegida.
 * Causa raíz confirmada en investigación (Task 1): H1 y H2 refutadas; la causa
 * real es doble: (a) el logout dependía del happy-path de signOut() — si falla
 * o lanza, la sesión queda viva o nunca se navega a /login — y (b) el router
 * solo reacciona a hashchange y nunca re-evalúa los guards al cambiar el estado
 * de auth; además el guard y el logout empujaban la ruta protegida al history
 * (back-trap). Este archivo cubre el endurecimiento de la navegación con
 * navigate(path, { replace }), el guard con replace, el logout robusto del
 * AuthButton y la re-evaluación de guards en SIGNED_OUT.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let authStateChangeHandler = null;
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn((fn) => {
  authStateChangeHandler = fn;
  return { data: { subscription: { unsubscribe: () => {} } } };
});
const mockSignOut = vi.fn();

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: mockSignOut,
    },
  },
}));

const { route, navigate, guardedRoute, configureAuth, refresh, getCurrentPath, initRouter } =
  await import('../src/router.js');
const { initAuthStore, isAuthenticated, needsOnboarding, isAdmin } =
  await import('../src/lib/authStore.js');
const { renderAuthButton } = await import('../src/components/AuthButton.js');

/** Bootstrap del authStore real (supabase mockeado) con sesión + perfil. */
async function initAuthStoreWithSession() {
  mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'tok' } } });
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ profile: { username: 'juan', isAdmin: false }, flags: [] }),
  });
  await initAuthStore();
}

describe('navigate con { replace }', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('aterriza en el destino y re-resuelve de forma síncrona', () => {
    const login = vi.fn();
    route('/login', login);
    navigate('/login', { replace: true });
    expect(getCurrentPath()).toBe('/login');
    expect(login).toHaveBeenCalled();
  });
});

describe('logout no re-expone una ruta protegida', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('tras signOut, ir a /login no vuelve a invocar el handler protegido', () => {
    let authed = true;
    configureAuth({
      isAuthenticated: () => authed,
      needsOnboarding: () => false,
      isAdmin: () => false,
    });
    const favHandler = vi.fn();
    const loginHandler = vi.fn();
    guardedRoute('/favoritos', favHandler);
    route('/login', loginHandler);

    // Usuario autenticado en /favoritos.
    window.location.hash = '/favoritos';
    refresh();
    expect(favHandler).toHaveBeenCalledTimes(1);

    // Logout: la sesión cae y navegamos a /login con replace.
    authed = false;
    navigate('/login', { replace: true });

    expect(getCurrentPath()).toBe('/login');
    expect(loginHandler).toHaveBeenCalled();
    // El handler protegido NO se vuelve a invocar tras el logout.
    expect(favHandler).toHaveBeenCalledTimes(1);
  });
});

describe('guard de no autenticado redirige con replace (sin back-trap)', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('resolver una ruta protegida sin sesión aterriza en /login?next=... sin crecer el history', () => {
    configureAuth({
      isAuthenticated: () => false,
      needsOnboarding: () => false,
      isAdmin: () => false,
    });
    const favHandler = vi.fn();
    const loginHandler = vi.fn();
    guardedRoute('/favoritos', favHandler);
    route('/login', loginHandler);

    window.location.hash = '/favoritos';
    const lengthBefore = window.history.length;
    refresh();

    expect(getCurrentPath()).toBe(`/login?next=${encodeURIComponent('/favoritos')}`);
    expect(loginHandler).toHaveBeenCalled();
    expect(favHandler).not.toHaveBeenCalled();
    // replaceState: la redirección del guard no añade entradas al history.
    expect(window.history.length).toBe(lengthBefore);
  });
});

describe('AuthButton: la navegación de logout ocurre aunque signOut falle', () => {
  /** @type {HTMLElement} */
  let mount;

  beforeEach(async () => {
    window.location.hash = '';
    document.body.innerHTML = '';
    mockSignOut.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await initAuthStoreWithSession();
    route('/login', vi.fn());
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  async function clickLogout() {
    renderAuthButton(mount);
    mount.querySelector('#auth-button').click();
    document.querySelector('#logout-btn').click();
    // El handler es async: drena las microtareas del try/catch/finally.
    await vi.waitFor(() => expect(getCurrentPath()).toBe('/login'));
  }

  it('signOut lanza (lock/red) → igualmente se navega a /login', async () => {
    mockSignOut.mockRejectedValueOnce(new Error('navigator-lock timeout'));
    await clickLogout();
    expect(console.error).toHaveBeenCalledWith('signOut falló', expect.any(Error));
    expect(document.querySelector('#auth-menu')).toBeNull();
  });

  it('signOut devuelve { error } sin lanzar → se registra y se navega a /login', async () => {
    const error = new Error('network');
    mockSignOut.mockResolvedValueOnce({ error });
    await clickLogout();
    expect(console.error).toHaveBeenCalledWith('signOut falló', error);
  });

  it('signOut OK → se navega a /login sin registrar errores', async () => {
    mockSignOut.mockResolvedValueOnce({ error: null });
    await clickLogout();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('SIGNED_OUT tardío re-evalúa el guard de la ruta visible', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('al disparar SIGNED_OUT estando en ruta protegida se termina en /login', async () => {
    await initAuthStoreWithSession();
    // Adapter real del authStore: el guard "ve" la caída de sesión.
    configureAuth({ isAuthenticated, needsOnboarding, isAdmin });
    const favHandler = vi.fn();
    const loginHandler = vi.fn();
    guardedRoute('/favoritos', favHandler);
    route('/login', loginHandler);

    window.location.hash = '/favoritos';
    refresh();
    expect(favHandler).toHaveBeenCalledTimes(1);

    // Cierre de sesión externo (otra pestaña, expiración): nadie llama navigate.
    await authStateChangeHandler('SIGNED_OUT', null);

    expect(getCurrentPath()).toBe(`/login?next=${encodeURIComponent('/favoritos')}`);
    expect(loginHandler).toHaveBeenCalled();
    expect(favHandler).toHaveBeenCalledTimes(1);
  });
});

describe('SIGNED_OUT estando ya en /login no duplica el render del login', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('el callback SIGNED_OUT no vuelve a invocar el handler de /login (incluso con query)', async () => {
    await initAuthStoreWithSession();
    configureAuth({ isAuthenticated, needsOnboarding, isAdmin });
    const loginHandler = vi.fn();
    route('/login', loginHandler);

    // Logout same-tab: el AuthButton ya navegó a /login (puede llevar ?next=...).
    window.location.hash = `/login?next=${encodeURIComponent('/favoritos')}`;
    refresh();
    expect(loginHandler).toHaveBeenCalledTimes(1);

    // El SIGNED_OUT posterior de supabase no debe re-resolver: ya estamos en /login.
    await authStateChangeHandler('SIGNED_OUT', null);

    expect(loginHandler).toHaveBeenCalledTimes(1);
  });
});

// NOTA: este describe va al final del archivo — initRouter() registra un listener
// de hashchange que persiste para el resto de los tests del archivo.
describe('initRouter no queda envenenado por un refresh() previo al registro de rutas', () => {
  it('un resolve temprano sin rutas que matcheen no impide el render inicial', () => {
    // Boot real: el hash ya apunta a la ruta pero ésta aún no está registrada
    // (en main.js initAuthStore() corre antes que initRouter()).
    window.location.hash = '/boot-inicial';
    // SIGNED_OUT durante el boot → refresh() resuelve sin match y deja
    // currentRoute apuntando al hash sin haber renderizado nada.
    refresh();

    const bootHandler = vi.fn();
    route('/boot-inicial', bootHandler);

    // initRouter descarta el currentRoute rancio: el resolve inicial SÍ renderiza.
    initRouter();
    expect(bootHandler).toHaveBeenCalledTimes(1);
  });
});
