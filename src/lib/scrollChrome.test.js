import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeHeaderVisibility,
  HIDE_THRESHOLD_PX,
  setChromeAutoHide,
  initChromeAutoHide,
} from './scrollChrome.js';

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

describe('chrome auto-hide (nav)', () => {
  let navEl, headerEl, rafCb;
  beforeEach(() => {
    document.body.innerHTML = '<header id="h"></header><nav id="n"></nav>';
    headerEl = document.getElementById('h');
    navEl = document.getElementById('n');
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCb = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    initChromeAutoHide({ headerEl, navEl });
  });

  const scrollTo = (y) => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    rafCb();
  };

  it('oculta nav y header al bajar y publica --bnav-offset 0', () => {
    setChromeAutoHide({ header: true, nav: true });
    scrollTo(0);
    scrollTo(50);
    expect(navEl.classList.contains('bottom-nav--auto-hide')).toBe(true);
    expect(headerEl.classList.contains('header--auto-hide')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--bnav-offset')).toBe('0px');
    scrollTo(30); // subir
    expect(navEl.classList.contains('bottom-nav--auto-hide')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--bnav-offset')).toBe('');
  });

  it('con nav-only no toca el header y resetea al cambiar de ruta', () => {
    setChromeAutoHide({ header: false, nav: true });
    scrollTo(0);
    scrollTo(50);
    expect(headerEl.classList.contains('header--auto-hide')).toBe(false);
    expect(navEl.classList.contains('bottom-nav--auto-hide')).toBe(true);
    setChromeAutoHide({ header: false, nav: false }); // nueva ruta sin auto-hide
    expect(navEl.classList.contains('bottom-nav--auto-hide')).toBe(false);
  });
});
