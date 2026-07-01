// src/lib/listUrgency.test.js
import { describe, it, expect } from 'vitest';
import { daysUntil, urgencyOf, sortByUrgency, countdownLabel } from './listUrgency.js';

const TODAY = '2026-07-01';

describe('daysUntil', () => {
  it('cuenta días de calendario', () => {
    expect(daysUntil('2026-07-10', TODAY)).toBe(9);
    expect(daysUntil('2026-07-01', TODAY)).toBe(0);
  });
  it('devuelve null sin fecha', () => {
    expect(daysUntil(null, TODAY)).toBeNull();
    expect(daysUntil(undefined, TODAY)).toBeNull();
  });
  it('ignora la parte hora del timestamp', () => {
    expect(daysUntil('2026-07-03T23:59:00Z', TODAY)).toBe(2);
  });
});

describe('urgencyOf — umbrales rojo≤2 · amarillo≤7 · verde>7', () => {
  const cases = [
    ['2026-07-01', 'red', 0],
    ['2026-07-03', 'red', 2],
    ['2026-07-04', 'amber', 3],
    ['2026-07-08', 'amber', 7],
    ['2026-07-09', 'green', 8],
    [null, 'neutral', null],
  ];
  it.each(cases)('%s → %s', (expires_at, level, daysLeft) => {
    expect(urgencyOf({ expires_at }, TODAY)).toEqual({ level, daysLeft });
  });
});

describe('sortByUrgency', () => {
  it('ordena asc por expires_at, sin fecha al final, sin mutar', () => {
    const input = [
      { id: 'a', expires_at: '2026-08-01' },
      { id: 'b', expires_at: null },
      { id: 'c', expires_at: '2026-07-05' },
    ];
    const out = sortByUrgency(input);
    expect(out.map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(input.map((l) => l.id)).toEqual(['a', 'b', 'c']); // no mutó
  });
  it('tolera null/undefined', () => {
    expect(sortByUrgency(null)).toEqual([]);
  });
});

describe('countdownLabel', () => {
  it.each([
    [null, 'fija'],
    [0, 'hoy'],
    [1, 'mañana'],
    [9, 'en 9 días'],
  ])('%s → %s', (daysLeft, label) => {
    expect(countdownLabel(daysLeft)).toBe(label);
  });
});
