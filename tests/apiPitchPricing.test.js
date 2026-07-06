import { describe, it, expect } from 'vitest';
import { estimate } from '../api/pitch/_lib/pricing.js';

describe('pitch pricing', () => {
  it('perfil oss es gratis (solo cómputo propio) → rango 0', () => {
    const e = estimate('oss', 180);
    expect(e.lo).toBe(0);
    expect(e.hi).toBe(0);
    expect(e.breakdown.every((b) => b.confirmed)).toBe(true);
  });

  it('precision (OSS) no cobra USD → rango 0', () => {
    const e = estimate('precision', 180); // 3 min
    expect(e.lo).toBe(0);
    expect(e.hi).toBe(0);
    expect(e.breakdown.every((b) => b.confirmed)).toBe(true);
  });

  it('precision sigue en 0 sin importar la duración', () => {
    const e = estimate('precision', 61); // 1.02 min, ya no afecta el costo
    expect(e.lo).toBe(0);
    expect(e.hi).toBe(0);
  });

  it('rechaza perfil desconocido', () => {
    expect(() => estimate('gold', 60)).toThrow(/perfil/i);
  });

  it('rechaza perfil desconocido con status 400', () => {
    try {
      estimate('gold', 60);
      throw new Error('no lanzó');
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });

  it('precision con duración inválida sigue en 0', () => {
    for (const bad of [undefined, 0, 'x', -30, NaN]) {
      const e = estimate('precision', bad);
      expect(e.hi).toBe(0);
      expect(e.lo).toBe(0);
    }
  });

  it('oss con duración inválida sigue en 0', () => {
    const e = estimate('oss', undefined);
    expect(e.hi).toBe(0);
    expect(e.lo).toBe(0);
  });
});
