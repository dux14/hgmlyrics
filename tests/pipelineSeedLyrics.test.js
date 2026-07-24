import { describe, it, expect } from 'vitest';
import { seedIndex, monotonicAlign } from '../api/_lib/pipeline/seedLyrics.js';

const SEED = [
  { type: 'verse', lines: [{ text: 'Primero el cielo' }, { text: 'y lo demás está de más' }] },
  { type: 'chorus', lines: [{ text: 'Sé que tú me cuidarás' }, { annotation: 'x2' }] },
];

describe('seedIndex', () => {
  it('aplana en el mismo orden que projectCanonicalLines, salteando annotations', () => {
    expect(seedIndex(SEED)).toEqual([
      { dbIndex: 0, sectionIdx: 0, lineIdx: 0, text: 'Primero el cielo' },
      { dbIndex: 1, sectionIdx: 0, lineIdx: 1, text: 'y lo demás está de más' },
      { dbIndex: 2, sectionIdx: 1, lineIdx: 0, text: 'Sé que tú me cuidarás' },
    ]);
  });

  it('sin semilla devuelve []', () => {
    expect(seedIndex(undefined)).toEqual([]);
  });
});

describe('monotonicAlign', () => {
  it('descarta el match espurio que rompe el orden', () => {
    const out = monotonicAlign([
      { transIndex: 0, dbIndex: 0, score: 0.95 },
      { transIndex: 1, dbIndex: 9, score: 0.55 }, // espurio, lejano
      { transIndex: 2, dbIndex: 1, score: 0.9 },
      { transIndex: 3, dbIndex: 2, score: 0.92 },
    ]);
    expect(out.map((p) => p.transIndex)).toEqual([0, 2, 3]);
  });

  it('conserva el bloque repetido (dbIndex igual no rompe monotonía)', () => {
    const out = monotonicAlign([
      { transIndex: 0, dbIndex: 3, score: 0.9 },
      { transIndex: 1, dbIndex: 3, score: 0.9 },
      { transIndex: 2, dbIndex: 4, score: 0.9 },
    ]);
    expect(out).toHaveLength(3);
  });

  it('ignora los pares sin match', () => {
    expect(monotonicAlign([{ transIndex: 0, dbIndex: null, score: 0 }])).toEqual([]);
  });
});
