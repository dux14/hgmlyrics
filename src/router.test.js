/**
 * router.test.js — enrutamiento hash + navegación "atrás" (goBack).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  route,
  navigate,
  goBack,
  openBackable,
  closeBackable,
  clearBackable,
  initRouter,
  getCurrentPath,
} from './router.js';

/** Espera a que se procese el hashchange/popstate (jsdom los despacha async). */
function tick(ms = 20) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resetea el history a una única entrada raíz antes de cada test. */
async function resetHistory() {
  window.history.replaceState(null, '', '#/');
  await tick();
}

describe('router — navegación básica', () => {
  beforeEach(async () => {
    await resetHistory();
  });

  it('resuelve la ruta actual al hacer navigate', async () => {
    const handler = vi.fn();
    route('/album/:id', handler);
    initRouter();

    navigate('/album/abc');
    await tick();

    expect(handler).toHaveBeenCalled();
    expect(getCurrentPath()).toBe('/album/abc');
  });
});

describe('router — goBack()', () => {
  beforeEach(async () => {
    await resetHistory();
  });

  it('vuelve a la pantalla anterior tras encadenar navegaciones', async () => {
    initRouter();

    navigate('/albumes');
    await tick();
    navigate('/album/x');
    await tick();
    expect(getCurrentPath()).toBe('/album/x');

    goBack();
    await tick();
    expect(getCurrentPath()).toBe('/albumes');
  });

  it('cae al home cuando no hay pantalla anterior en la sesión', async () => {
    // Arranque directo en una vista profunda (deep link): no hay entrada previa
    // dentro de la app, así que goBack debe llevar al home, no salir de la app.
    window.history.replaceState(null, '', '#/album/x');
    await tick();
    initRouter();

    goBack();
    await tick();

    expect(getCurrentPath()).toBe('/');
  });
});

describe('router — capa backable (focus de búsqueda)', () => {
  beforeEach(async () => {
    clearBackable();
    await resetHistory();
  });

  it('el atrás nativo cierra la capa y se queda en la misma ruta', async () => {
    initRouter();
    navigate('/buscar');
    await tick();

    const onBack = vi.fn();
    openBackable(onBack); // p. ej. el usuario empieza a escribir → focus
    await tick();
    expect(getCurrentPath()).toBe('/buscar');

    window.history.back(); // gesto/flecha atrás nativa
    await tick();

    expect(onBack).toHaveBeenCalledTimes(1); // cerró el focus
    expect(getCurrentPath()).toBe('/buscar'); // NO salió de /buscar
  });

  it('closeBackable consume la entrada sin volver a disparar onBack', async () => {
    initRouter();
    navigate('/buscar');
    await tick();

    const onBack = vi.fn();
    openBackable(onBack);
    await tick();

    closeBackable(); // Escape / botón limpiar (el cierre visual ya lo hizo el llamador)
    await tick();

    expect(onBack).not.toHaveBeenCalled();
    expect(getCurrentPath()).toBe('/buscar');
  });
});
