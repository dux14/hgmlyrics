import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PRELOAD_RELOAD_KEY,
  initPreloadErrorGuard,
  clearPreloadErrorGuard,
} from './preloadErrorGuard.js';

describe('preloadErrorGuard', () => {
  let reloadSpy;

  beforeEach(() => {
    sessionStorage.clear();
    // jsdom no permite location.reload real: se reemplaza por un spy.
    reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...globalThis.location, reload: reloadSpy });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recarga y setea el guard en el primer preloadError', () => {
    initPreloadErrorGuard();
    const event = new Event('vite:preloadError', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    globalThis.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PRELOAD_RELOAD_KEY)).toBe('1');
  });

  it('no recarga de nuevo si el guard ya esta seteado (evita loop)', () => {
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
    initPreloadErrorGuard();
    const event = new Event('vite:preloadError', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    globalThis.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('clearPreloadErrorGuard rearma el guard tras un boot exitoso', () => {
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
    clearPreloadErrorGuard();
    expect(sessionStorage.getItem(PRELOAD_RELOAD_KEY)).toBeNull();
  });

  it('con sessionStorage.getItem bloqueado, deja que Vite propague el error (no recarga)', () => {
    // Simula Safari "Block All Cookies" / contextos sandboxed: getItem lanza.
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError: blocked');
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    initPreloadErrorGuard();
    const event = new Event('vite:preloadError', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    globalThis.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
