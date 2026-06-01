import { describe, it, expect } from 'vitest';
import {
  toggleBoundary,
  boundariesToSyllables,
  syllablesToBoundaries,
  autoSuggestBoundaries,
} from '../src/lib/syllabify.js';

describe('boundariesToSyllables', () => {
  it('convierte cortes en sílabas {start,end} cubriendo todo el texto', () => {
    expect(boundariesToSyllables('Santo', [3])).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
    ]);
  });
  it('sin cortes devuelve una sola sílaba con todo el texto', () => {
    expect(boundariesToSyllables('Santo', [])).toEqual([{ start: 0, end: 5 }]);
  });
  it('texto vacío devuelve []', () => {
    expect(boundariesToSyllables('', [])).toEqual([]);
  });
});

describe('syllablesToBoundaries', () => {
  it('es inverso de boundariesToSyllables', () => {
    const sylls = boundariesToSyllables('Santo', [3]);
    expect(syllablesToBoundaries(sylls)).toEqual([3]);
  });
});

describe('toggleBoundary', () => {
  it('agrega un corte si no existe (ordenado, sin duplicados)', () => {
    expect(toggleBoundary([3], 1)).toEqual([1, 3]);
  });
  it('quita un corte si ya existe', () => {
    expect(toggleBoundary([1, 3], 3)).toEqual([1]);
  });
  it('ignora cortes en 0 o al final (no parten nada)', () => {
    expect(toggleBoundary([], 0, 5)).toEqual([]);
    expect(toggleBoundary([], 5, 5)).toEqual([]);
  });
});

describe('autoSuggestBoundaries', () => {
  it('sugiere cortes tras grupos vocálicos (heurística simple, editable)', () => {
    // "Santo" → "San" "to": corte en 3
    expect(autoSuggestBoundaries('Santo')).toContain(3);
  });
});
