import { describe, it, expect } from 'vitest';
import { midiToName, centsBetween, noteToFrequency } from './notes.js';

describe('centsBetween', () => {
  it('da 0 cuando la frecuencia coincide con la referencia', () => {
    expect(centsBetween(440, 440)).toBe(0);
  });

  it('una octava arriba = +1200, una octava abajo = -1200', () => {
    expect(centsBetween(880, 440)).toBe(1200);
    expect(centsBetween(220, 440)).toBe(-1200);
  });

  it('un semitono arriba ~ +100 cents', () => {
    expect(centsBetween(noteToFrequency('A#4'), noteToFrequency('A4'))).toBe(100);
  });

  it('cantar una nota distinta bien afinada NO da ~0 respecto al objetivo', () => {
    // C4 cantado perfecto, objetivo A3: debe ser una desviacion grande, no cero.
    const cents = centsBetween(noteToFrequency('C4'), noteToFrequency('A3'));
    expect(Math.abs(cents)).toBeGreaterThan(200);
  });

  it('devuelve NaN con entradas invalidas', () => {
    expect(centsBetween(0, 440)).toBeNaN();
    expect(centsBetween(440, 0)).toBeNaN();
    expect(centsBetween(NaN, 440)).toBeNaN();
    expect(centsBetween(440, Infinity)).toBeNaN();
  });
});

describe('midiToName', () => {
  it('mapea numeros MIDI a nombre + octava', () => {
    expect(midiToName(48)).toBe('C3');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(81)).toBe('A5');
    expect(midiToName(61)).toBe('C#4');
  });
});
