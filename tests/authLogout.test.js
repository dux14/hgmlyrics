// tests/authLogout.test.js
/**
 * Regresión del bug: logout que a veces aterriza en una ruta protegida.
 * Causa raíz confirmada en investigación (Task 1): H1 y H2 refutadas; la causa
 * real es doble: (a) el logout dependía del happy-path de signOut() — si falla
 * o lanza, la sesión queda viva o nunca se navega a /login — y (b) el router
 * solo reacciona a hashchange y nunca re-evalúa los guards al cambiar el estado
 * de auth; además el guard y el logout empujaban la ruta protegida al history
 * (back-trap). Este archivo cubre el endurecimiento de la navegación con
 * navigate(path, { replace }); el endurecimiento del logout llega en Task 4.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  route,
  navigate,
  guardedRoute,
  configureAuth,
  refresh,
  getCurrentPath,
} from '../src/router.js';

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
