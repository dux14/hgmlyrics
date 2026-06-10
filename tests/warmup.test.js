import { describe, it, expect } from 'vitest';
import { buildWarmup, DEFAULT_RANGES } from '../src/lib/warmup.js';

describe('buildWarmup', () => {
  it('genera runs 1-2-3-2-1 cubriendo el rango dado', () => {
    const seq = buildWarmup({ rangeLow: 'C4', rangeHigh: 'E4' });
    expect(seq).toEqual(['C4', 'D4', 'E4', 'D4', 'C4']);
  });

  it('encadena varios runs subiendo de a un semitono', () => {
    const seq = buildWarmup({ rangeLow: 'C4', rangeHigh: 'F4' });
    expect(seq.slice(0, 5)).toEqual(['C4', 'D4', 'E4', 'D4', 'C4']);
    expect(seq.slice(5, 10)).toEqual(['C#4', 'D#4', 'F4', 'D#4', 'C#4']);
  });

  it('cae al rango por defecto de la voz cuando falta rango', () => {
    const seq = buildWarmup({ voiceType: 'bajo' });
    expect(seq[0]).toBe('E2');
    expect(seq.length).toBeGreaterThan(0);
  });

  it('expone rangos por defecto para las 4 voces', () => {
    expect(DEFAULT_RANGES).toMatchObject({
      soprano: ['C4', 'C6'],
      contralto: ['F3', 'F5'],
      tenor: ['C3', 'C5'],
      bajo: ['E2', 'E4'],
    });
  });
});
