import { describe, it, expect } from 'vitest';
import { centsToBarPercent } from './tunerGauge.js';

describe('centsToBarPercent', () => {
  it('mapea -50 cents a 0', () => {
    expect(centsToBarPercent(-50)).toBe(0);
  });

  it('mapea 0 cents al centro (50)', () => {
    expect(centsToBarPercent(0)).toBe(50);
  });

  it('mapea +50 cents a 100', () => {
    expect(centsToBarPercent(50)).toBe(100);
  });

  it('aplica clamp fuera de rango', () => {
    expect(centsToBarPercent(80)).toBe(100);
    expect(centsToBarPercent(-80)).toBe(0);
  });

  it('null/undefined caen al centro (50)', () => {
    expect(centsToBarPercent(null)).toBe(50);
    expect(centsToBarPercent(undefined)).toBe(50);
  });

  it('NaN cae al centro (50)', () => {
    expect(centsToBarPercent(NaN)).toBe(50);
  });
});
