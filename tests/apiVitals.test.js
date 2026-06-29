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
});
