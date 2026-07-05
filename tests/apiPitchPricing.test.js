import { describe, it, expect } from 'vitest';
import { estimate, RATES } from '../api/pitch/_lib/pricing.js';

describe('pitch pricing', () => {
  it('perfil oss es gratis (solo cómputo propio) → rango 0', () => {
    const e = estimate('oss', 180);
    expect(e.lo).toBe(0);
    expect(e.hi).toBe(0);
    expect(e.breakdown.every((b) => b.confirmed)).toBe(true);
  });

  it('precision cobra separación+letra por minuto (AudioShake)', () => {
    const e = estimate('precision', 180); // 3 min
    const min = 3;
    expect(e.hi).toBeCloseTo(min * RATES.precision.audioshake_per_min, 5);
    expect(e.lo).toBeLessThanOrEqual(e.hi);
    expect(e.breakdown.find((b) => b.phase === 'separation+lyrics')).toBeTruthy();
  });

  it('redondea duración hacia arriba al minuto para cobro', () => {
    const e = estimate('precision', 61); // 1.02 min → cobra 2 min
    expect(e.hi).toBeCloseTo(2 * RATES.precision.audioshake_per_min, 5);
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

  it('degrada duración inválida al mínimo de 1 minuto (precision)', () => {
    const rate = RATES.precision.audioshake_per_min;
    for (const bad of [undefined, 0, 'x', -30, NaN]) {
      const e = estimate('precision', bad);
      expect(e.hi).toBeCloseTo(1 * rate, 5); // piso de 1 minuto
    }
  });

  it('oss con duración inválida sigue en 0', () => {
    const e = estimate('oss', undefined);
    expect(e.hi).toBe(0);
    expect(e.lo).toBe(0);
  });
});
