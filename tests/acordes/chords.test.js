import { describe, it, expect } from 'vitest';
import { isChord, isChordLine, isInlineableChord } from '../../scripts/acordes/lib/chords.mjs';

describe('isChord', () => {
  it('acepta acordes válidos', () => {
    for (const c of ['A', 'Am', 'G/B', 'Asus4', 'Cmaj7', 'F#m', 'Bb', 'Dm7b5'])
      {expect(isChord(c), c).toBe(true);}
  });
  it('rechaza palabras de letra', () => {
    for (const w of ['Sal', 'de', 'ti', 'amor', '']) expect(isChord(w), w).toBe(false);
  });
});

describe('isChordLine', () => {
  it('true cuando todos los tokens son acordes', () => {
    expect(isChordLine({ text: 'Am  F  C  G' })).toBe(true);
  });
  it('false con texto de letra', () => {
    expect(isChordLine({ text: 'Sal de ti' })).toBe(false);
  });
});

describe('isInlineableChord', () => {
  it('acepta los que calzan el regex del importador', () => {
    for (const c of ['Am', 'Cmaj7', 'Asus4', 'G/B']) expect(isInlineableChord(c), c).toBe(true);
  });
  it('rechaza extendidos no soportados por el importador', () => {
    expect(isInlineableChord('Dm7b5')).toBe(false);
  });
});
