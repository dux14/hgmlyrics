import { describe, it, expect } from 'vitest';
import { guessType, classifySections } from '../../scripts/acordes/lib/sections.mjs';

describe('guessType', () => {
  it('mapea etiquetas conocidas', () => {
    expect(guessType('Coro')).toBe('chorus');
    expect(guessType('Verso 1')).toBe('verse');
    expect(guessType('Pre-Coro')).toBe('prechorus');
    expect(guessType('Intro')).toBe('intro');
  });
  it('devuelve null para etiqueta desconocida', () => {
    expect(guessType('Xyz')).toBeNull();
  });
});

describe('classifySections', () => {
  it('usa la etiqueta del PDF cuando existe', () => {
    const out = classifySections([{ label: 'Coro', lines: [{ text: 'a', chords: [] }] }]);
    expect(out[0]).toMatchObject({ type: 'chorus', review: false });
  });
  it('solo-acordes → intro', () => {
    const out = classifySections([{ lines: [{ text: '', chords: [{ pos: 0, ch: 'Am' }] }] }]);
    expect(out[0]).toMatchObject({ type: 'intro', review: false });
  });
  it('texto repetido literal → chorus', () => {
    const sec = () => ({ lines: [{ text: 'Aleluya', chords: [] }] });
    const out = classifySections([sec(), { lines: [{ text: 'verso', chords: [] }] }, sec()]);
    expect(out[0].type).toBe('chorus');
    expect(out[2].type).toBe('chorus');
  });
  it('resto ambiguo → verse con review', () => {
    const out = classifySections([{ lines: [{ text: 'unico verso', chords: [] }] }]);
    expect(out[0]).toMatchObject({ type: 'verse', review: true });
  });
});
