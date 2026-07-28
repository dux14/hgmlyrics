/**
 * main.chrome.test.js — chrome por ruta (header + bottom-nav + sidebar).
 *
 * La lógica vive en `./lib/chromeRoutes.js` (extraída de main.js, patrón
 * `scrollChrome.js`): importar main.js directo dispararía todo el bootstrap
 * de la app (initTheme, router, fetch de sesión, etc.), no apto para un
 * test unitario puro.
 */
import { describe, it, expect } from 'vitest';
import { chromeFor, isHeaderless, isNavHidden } from './lib/chromeRoutes.js';

describe('chromeFor — vistas de pipeline (Task 2)', () => {
  it('procesamiento: headerless y sin bottom-nav', () => {
    expect(chromeFor('/song/abc/procesamiento')).toEqual(
      expect.objectContaining({ headerless: true, nav: false }),
    );
  });

  it('estudio: headerless y sin bottom-nav', () => {
    expect(chromeFor('/song/abc/estudio')).toEqual(
      expect.objectContaining({ headerless: true, nav: false }),
    );
  });

  it('partitura: headerless y sin bottom-nav', () => {
    expect(chromeFor('/song/abc/partitura')).toEqual(
      expect.objectContaining({ headerless: true, nav: false }),
    );
  });

  it('isHeaderless() e isNavHidden() true en las 3 vistas de pipeline', () => {
    for (const path of ['/song/abc/procesamiento', '/song/abc/estudio', '/song/abc/partitura']) {
      expect(isHeaderless(path)).toBe(true);
      expect(isNavHidden(path)).toBe(true);
    }
  });

  it('/song/:id conserva su chrome actual (header + nav, no headerless)', () => {
    expect(chromeFor('/song/abc')).toEqual(expect.objectContaining({ header: true, nav: true }));
    expect(isHeaderless('/song/abc')).toBe(false);
    expect(isNavHidden('/song/abc')).toBe(false);
  });
});
