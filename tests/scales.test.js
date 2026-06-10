import { describe, it, expect } from 'vitest';
import {
  SCALE_INTERVALS,
  EXERCISE_PRESETS,
  buildScaleSequence,
  pickStartOctave,
} from '../src/lib/scales.js';

describe('SCALE_INTERVALS', () => {
  it('define las 4 escalas con los intervalos correctos', () => {
    expect(SCALE_INTERVALS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(SCALE_INTERVALS.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(SCALE_INTERVALS.majorPentatonic).toEqual([0, 2, 4, 7, 9]);
    expect(SCALE_INTERVALS.minorPentatonic).toEqual([0, 3, 5, 7, 10]);
  });
});

describe('EXERCISE_PRESETS', () => {
  it('tiene los 4 presets pedidos con id/tonic/type', () => {
    const ids = EXERCISE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(['c-major-pentatonic', 'c-major', 'e-minor-pentatonic', 'e-minor']);
    const byId = Object.fromEntries(EXERCISE_PRESETS.map((p) => [p.id, p]));
    expect(byId['c-major-pentatonic']).toMatchObject({ tonic: 'C', type: 'majorPentatonic' });
    expect(byId['e-minor']).toMatchObject({ tonic: 'E', type: 'minor' });
  });
});

describe('buildScaleSequence', () => {
  it('Do Mayor pentatónica ascendente = C D E G A + tónica superior', () => {
    const seq = buildScaleSequence({
      tonic: 'C',
      type: 'majorPentatonic',
      startOctave: 4,
      direction: 'up',
    });
    expect(seq).toEqual(['C4', 'D4', 'E4', 'G4', 'A4', 'C5']);
  });

  it('Mi menor pentatónica = E G A B D (clases de altura)', () => {
    const seq = buildScaleSequence({
      tonic: 'E',
      type: 'minorPentatonic',
      startOctave: 3,
      direction: 'up',
    });
    expect(seq).toEqual(['E3', 'G3', 'A3', 'B3', 'D4', 'E4']);
  });

  it('Mi menor natural = E F# G A B C D', () => {
    const seq = buildScaleSequence({ tonic: 'E', type: 'minor', startOctave: 3, direction: 'up' });
    expect(seq).toEqual(['E3', 'F#3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4']);
  });

  it('up-down: sube y baja sin repetir la nota más aguda', () => {
    const seq = buildScaleSequence({
      tonic: 'C',
      type: 'majorPentatonic',
      startOctave: 4,
      direction: 'up-down',
    });
    expect(seq).toEqual(['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'A4', 'G4', 'E4', 'D4', 'C4']);
  });

  it('lanza con un tipo de escala desconocido', () => {
    expect(() => buildScaleSequence({ tonic: 'C', type: 'lydian', startOctave: 4 })).toThrow();
  });
});

describe('pickStartOctave', () => {
  it('elige una octava cuya secuencia de 1 octava entra en el rango', () => {
    const oct = pickStartOctave({ tonic: 'C', type: 'major', rangeLow: 'C3', rangeHigh: 'C5' });
    expect(oct).toBe(3);
    const seq = buildScaleSequence({
      tonic: 'C',
      type: 'major',
      startOctave: oct,
      direction: 'up',
    });
    expect(seq[0]).toBe('C3');
    expect(seq[seq.length - 1]).toBe('C4');
  });

  it('devuelve un entero entre 1 y 6', () => {
    const oct = pickStartOctave({ tonic: 'E', type: 'minor', rangeLow: 'E2', rangeHigh: 'E4' });
    expect(Number.isInteger(oct)).toBe(true);
    expect(oct).toBeGreaterThanOrEqual(1);
    expect(oct).toBeLessThanOrEqual(6);
  });
});
