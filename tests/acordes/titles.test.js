import { describe, it, expect } from 'vitest';
import { normalizeTitle, levenshtein, matchByTitle } from '../../scripts/acordes/lib/titles.mjs';

describe('normalizeTitle', () => {
  it('quita acentos, emojis y baja a minúsculas', () => {
    expect(normalizeTitle('Olor a Tostadas 🍞')).toBe('olor a tostadas');
    expect(normalizeTitle('Canción Nº1')).toBe('cancion n 1');
  });
});

describe('levenshtein', () => {
  it('cuenta ediciones', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('abc', 'abd')).toBe(1);
  });
});

describe('matchByTitle', () => {
  it('empareja por título normalizado exacto y reporta no-matches', () => {
    const pdf = [{ title: 'Olor a Tostadas' }, { title: 'Faltante PDF' }];
    const db = [
      { id: '1', title: 'olor a tostadas 🍞' },
      { id: '2', title: 'Otra de BD' },
    ];
    const { pairs, unmatchedPdf, unmatchedDb } = matchByTitle(pdf, db);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].db.id).toBe('1');
    expect(unmatchedPdf.map((p) => p.title)).toEqual(['Faltante PDF']);
    expect(unmatchedDb.map((d) => d.id)).toEqual(['2']);
  });

  it('cae a fuzzy (Levenshtein ≤ 2) cuando no hay exacto', () => {
    const pdf = [{ title: 'Aleluia' }]; // typo
    const db = [{ id: '9', title: 'Aleluya' }];
    expect(matchByTitle(pdf, db).pairs[0].db.id).toBe('9');
  });
});
