import { describe, it, expect, vi } from 'vitest';

// Mock postgres antes de importar el modulo (DATABASE_URL requerido al nivel de modulo)
function sqlMock(strings, ...values) {
  if (!strings?.raw) return strings;
  return Promise.resolve([]);
}
sqlMock.json = (v) => v;
vi.mock('postgres', () => ({ default: () => sqlMock }));

process.env.DATABASE_URL = 'postgresql://test';

const { validateVital } = await import('../api/vitals.js');

describe('validateVital', () => {
  it('rechaza metric desconocida', () => {
    expect(validateVital({ metric: 'XXX', value: 1 })).toBe(false);
  });
  it('rechaza value no numerico', () => {
    expect(validateVital({ metric: 'LCP', value: 'x' })).toBe(false);
  });
  it('acepta payload valido', () => {
    expect(validateVital({ metric: 'LCP', value: 1200, rating: 'good' })).toBe(true);
  });
  it('rechaza value fuera de rango', () => {
    expect(validateVital({ metric: 'LCP', value: 1e9 })).toBe(false);
  });
  it('rechaza rating que no es string (evita [object Object] en DB)', () => {
    expect(validateVital({ metric: 'LCP', value: 100, rating: { x: 1 } })).toBe(false);
  });
  it('rechaza path arbitrariamente largo', () => {
    expect(validateVital({ metric: 'LCP', value: 100, path: 'A'.repeat(5000) })).toBe(false);
  });
  it('acepta rating en el borde (needs-improvement)', () => {
    expect(validateVital({ metric: 'CLS', value: 0.2, rating: 'needs-improvement' })).toBe(true);
  });
  it('rechaza attribution.target no serializable', () => {
    expect(validateVital({ metric: 'INP', value: 50, attribution: { target: { a: 1 } } })).toBe(false);
  });
});
