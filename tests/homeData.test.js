import { describe, it, expect } from 'vitest';
import { selectRecent } from '../src/components/Home.js';

const songs = [
  { id: 'a', year: 2022, albumOrder: 1 },
  { id: 'b', year: 2024, albumOrder: 2 },
  { id: 'c', year: 2024, albumOrder: 5 },
  { id: 'd', year: 2023, albumOrder: 1 },
];

describe('selectRecent', () => {
  it('ordena por year desc y desempata por albumOrder desc', () => {
    expect(selectRecent(songs).map((s) => s.id)).toEqual(['c', 'b', 'd', 'a']);
  });
  it('respeta el limit', () => {
    expect(selectRecent(songs, 2).map((s) => s.id)).toEqual(['c', 'b']);
  });
  it('tolera entrada vacía o nula', () => {
    expect(selectRecent(null)).toEqual([]);
    expect(selectRecent([])).toEqual([]);
  });
  it('no muta el array de entrada', () => {
    const copy = [...songs];
    selectRecent(songs);
    expect(songs).toEqual(copy);
  });
});
