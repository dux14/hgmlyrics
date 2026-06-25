import { describe, it, expect } from 'vitest';
import { xToCharIndex } from '../../scripts/acordes/lib/chords.mjs';

describe('xToCharIndex', () => {
  // Línea "Sal de ti" (9 chars) en un item: x=100, width=90 → 10px/char.
  const lyric = { text: 'Sal de ti', items: [{ str: 'Sal de ti', x: 100, width: 90 }] };

  it('mapea x al índice de carácter más cercano', () => {
    expect(xToCharIndex(100, lyric)).toBe(0); // 'S'
    expect(xToCharIndex(170, lyric)).toBe(7); // 't'
    expect(xToCharIndex(124, lyric)).toBe(2); // 'l' (124→2.4→2)
  });

  it('clampa fuera de rango', () => {
    expect(xToCharIndex(0, lyric)).toBe(0);
    expect(xToCharIndex(9999, lyric)).toBe(9);
  });

  it('línea vacía → 0', () => {
    expect(xToCharIndex(50, { text: '', items: [] })).toBe(0);
  });
});
