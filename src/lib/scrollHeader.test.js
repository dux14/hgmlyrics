import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeHeaderVisibility, attachAutoHideHeader, HIDE_THRESHOLD_PX } from './scrollHeader.js';

describe('computeHeaderVisibility', () => {
  it('mantiene visible en el tope (scrollY 0)', () => {
    expect(computeHeaderVisibility({ scrollY: 0, lastScrollY: 300, visible: false })).toBe(true);
  });

  it('oculta al bajar más que el umbral', () => {
    const lastScrollY = 100;
    const scrollY = lastScrollY + HIDE_THRESHOLD_PX + 1;
    expect(computeHeaderVisibility({ scrollY, lastScrollY, visible: true })).toBe(false);
  });

  it('no oculta al bajar por debajo del umbral (intent insuficiente)', () => {
    const lastScrollY = 100;
    const scrollY = lastScrollY + HIDE_THRESHOLD_PX - 1;
    expect(computeHeaderVisibility({ scrollY, lastScrollY, visible: true })).toBe(true);
  });

  it('muestra ante cualquier scroll hacia arriba', () => {
    expect(computeHeaderVisibility({ scrollY: 200, lastScrollY: 250, visible: false })).toBe(true);
  });

  it('conserva el estado si no hay delta', () => {
    expect(computeHeaderVisibility({ scrollY: 200, lastScrollY: 200, visible: false })).toBe(false);
    expect(computeHeaderVisibility({ scrollY: 200, lastScrollY: 200, visible: true })).toBe(true);
  });
});

/** Fake mínimo de onRouteChange (router.js): registra callbacks y permite dispararlos. */
function fakeRouteChange() {
  const listeners = [];
  const onRouteChange = (cb) => {
    listeners.push(cb);
    return () => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  };
  const trigger = () => listeners.slice().forEach((cb) => cb());
  return { onRouteChange, trigger, listeners };
}

function setScrollY(value) {
  Object.defineProperty(window, 'scrollY', { value, configurable: true });
}

describe('attachAutoHideHeader', () => {
  let rafSpy;
  let cafSpy;

  beforeEach(() => {
    setScrollY(0);
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb();
      return 1;
    });
    cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  it('engancha un listener de scroll (passive) al montar', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const header = document.createElement('header');
    attachAutoHideHeader(header, fakeRouteChange().onRouteChange);
    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    addSpy.mockRestore();
  });

  it('oculta el header al bajar y lo muestra al subir', () => {
    const header = document.createElement('header');
    attachAutoHideHeader(header, fakeRouteChange().onRouteChange);

    setScrollY(100);
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('header--auto-hide')).toBe(true);

    setScrollY(90);
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('header--auto-hide')).toBe(false);
  });

  it('remueve el listener de scroll y restaura visibilidad al cambiar de ruta', () => {
    const header = document.createElement('header');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { onRouteChange, trigger } = fakeRouteChange();
    attachAutoHideHeader(header, onRouteChange);

    setScrollY(100);
    window.dispatchEvent(new Event('scroll'));
    expect(header.classList.contains('header--auto-hide')).toBe(true);

    trigger();

    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(header.classList.contains('header--auto-hide')).toBe(false);
    removeSpy.mockRestore();
  });
});
