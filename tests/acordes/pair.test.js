import { describe, it, expect } from 'vitest';
import { pairChordLines } from '../../scripts/acordes/lib/pair.mjs';

describe('pairChordLines', () => {
  it('empareja la línea de acordes con la letra ~14px debajo y posiciona', () => {
    const lines = [
      {
        y: 514,
        items: [
          { str: 'Am', x: 100, width: 18 },
          { str: 'E', x: 170, width: 8 },
        ],
        text: 'AmE',
      },
      { y: 500, items: [{ str: 'Sal de ti', x: 100, width: 90 }], text: 'Sal de ti' },
    ];
    const out = pairChordLines(lines, 14, 4);
    expect(out).toEqual([
      {
        text: 'Sal de ti',
        chords: [
          { pos: 0, ch: 'Am' },
          { pos: 7, ch: 'E' },
        ],
      },
    ]);
  });

  it('línea de letra sin acordes encima → chords vacío', () => {
    const lines = [
      { y: 500, items: [{ str: 'solo letra', x: 100, width: 100 }], text: 'solo letra' },
    ];
    expect(pairChordLines(lines)).toEqual([{ text: 'solo letra', chords: [] }]);
  });
});
