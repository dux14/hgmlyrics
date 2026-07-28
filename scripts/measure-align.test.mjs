import { describe, it, expect } from 'vitest';
import { mean, median, p90, pearson, matchByIndex } from './measure-align-stats.mjs';

describe('mean', () => {
  it('calcula la media de varios valores', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('un solo valor devuelve ese valor', () => {
    expect(mean([42])).toBe(42);
  });
});

describe('median', () => {
  it('longitud impar: devuelve el valor central', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('longitud par: promedia los dos centrales', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('un solo valor devuelve ese valor', () => {
    expect(median([7])).toBe(7);
  });
});

describe('p90', () => {
  it('nearest-rank sobre 10 valores ordenados 1..10 → el 9º valor', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(p90(values)).toBe(9);
  });

  it('funciona sin importar el orden de entrada', () => {
    const values = [10, 3, 7, 1, 9, 2, 8, 4, 6, 5];
    expect(p90(values)).toBe(9);
  });

  it('un solo valor devuelve ese valor', () => {
    expect(p90([100])).toBe(100);
  });
});

describe('pearson', () => {
  it('correlación perfecta positiva (+1)', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [2, 4, 6, 8, 10];
    expect(pearson(xs, ys)).toBeCloseTo(1, 6);
  });

  it('correlación perfecta negativa (-1)', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [10, 8, 6, 4, 2];
    expect(pearson(xs, ys)).toBeCloseTo(-1, 6);
  });

  it('sin correlación (~0)', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ys = [6, 8, 1, 10, 5, 2, 4, 7, 3, 9];
    expect(Math.abs(pearson(xs, ys))).toBeLessThan(0.05);
  });
});

describe('matchByIndex', () => {
  it('empareja por índice i, ignora huérfanas de ambos lados', () => {
    const gtLines = [
      { i: 0, startMs: 100, interpolated: false },
      { i: 1, startMs: 200, interpolated: true },
      { i: 2, startMs: 300, interpolated: false },
    ];
    const newLines = [
      { i: 1, startMs: 250 },
      { i: 2, startMs: 280 },
      { i: 3, startMs: 400 },
    ];

    const { pairs, orphanGt, orphanNew } = matchByIndex(gtLines, newLines);

    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ i: 1, gt: { startMs: 200 }, next: { startMs: 250 } });
    expect(pairs[1]).toMatchObject({ i: 2, gt: { startMs: 300 }, next: { startMs: 280 } });
    expect(orphanGt).toEqual([0]);
    expect(orphanNew).toEqual([3]);
  });

  it('sin matches devuelve pairs vacío y ambas listas de huérfanas', () => {
    const gtLines = [{ i: 0, startMs: 10, interpolated: false }];
    const newLines = [{ i: 5, startMs: 50 }];

    const { pairs, orphanGt, orphanNew } = matchByIndex(gtLines, newLines);

    expect(pairs).toEqual([]);
    expect(orphanGt).toEqual([0]);
    expect(orphanNew).toEqual([5]);
  });
});
