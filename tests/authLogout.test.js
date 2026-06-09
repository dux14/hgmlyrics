// tests/authLogout.test.js
/**
 * Regresión del bug: logout que a veces aterriza en una ruta protegida.
 * Causa raíz confirmada en investigación (Task 1): el fix del plan cubre el
 * back-trap (la redirección del guard y el logout empujaban la ruta protegida
 * al history); además signOut() puede fallar/lanzar sin que nadie re-evalúe
 * los guards (se endurece en la tarea siguiente).
 * Este fix añade navigate(path, { replace }) con re-resolve síncrono.
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
