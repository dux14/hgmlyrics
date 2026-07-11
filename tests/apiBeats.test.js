/**
 * apiBeats.test.js — TDD para validateBeats (rejilla de metronomo del webhook
 * de align). Best-effort: se usa desde el webhook para descartar (no fallar)
 * un bloque `beats` invalido.
 */
import { describe, it, expect } from 'vitest';
import { validateBeats } from '../api/_lib/beats.js';

describe('validateBeats', () => {
  it('null pasa (best-effort)', () => {
    expect(validateBeats(null)).toBeNull();
  });

  it('undefined pasa (best-effort)', () => {
    expect(validateBeats(undefined)).toBeNull();
  });

  it('bpm no numerico o <=0 falla', () => {
    expect(validateBeats({ bpm: 0, beatsMs: [1, 2] })).toMatch(/bpm/);
    expect(validateBeats({ bpm: 'nope', beatsMs: [1, 2] })).toMatch(/bpm/);
    expect(validateBeats({ bpm: -1, beatsMs: [1, 2] })).toMatch(/bpm/);
  });

  it('bpm >= 400 falla', () => {
    expect(validateBeats({ bpm: 400, beatsMs: [1, 2] })).toMatch(/bpm/);
  });

  it('beatsMs no-array falla', () => {
    expect(validateBeats({ bpm: 92, beatsMs: 'nope' })).toMatch(/beatsMs/);
  });

  it('beatsMs de 1 elemento falla', () => {
    expect(validateBeats({ bpm: 92, beatsMs: [0] })).toMatch(/beatsMs/);
  });

  it('beatsMs no crecientes fallan', () => {
    expect(validateBeats({ bpm: 92, beatsMs: [10, 10] })).toMatch(/beatsMs/);
  });

  it('beatsMs con float falla', () => {
    expect(validateBeats({ bpm: 92, beatsMs: [0, 650.5] })).toMatch(/beatsMs/);
  });

  it('beatsMs con negativo falla', () => {
    expect(validateBeats({ bpm: 92, beatsMs: [-1, 650] })).toMatch(/beatsMs/);
  });

  it('beats validos pasan', () => {
    expect(validateBeats({ bpm: 92.5, beatsMs: [0, 650, 1300] })).toBeNull();
  });
});
