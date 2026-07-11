/**
 * apiBeats.test.js — TDD para validateBeats (rejilla de metronomo del webhook
 * de align). Best-effort: se usa desde el webhook para descartar (no fallar)
 * un bloque `beats` invalido.
 */
import { describe, it, expect } from 'vitest';
import { validateBeats, validatePatchBody } from '../api/_lib/beats.js';

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

describe('validatePatchBody', () => {
  it('campos ausentes (undefined) son validos — PATCH parcial', () => {
    expect(validatePatchBody({ bpmManual: 120 })).toBeNull();
    expect(validatePatchBody({ timeSignature: '3/4' })).toBeNull();
    expect(validatePatchBody({ beatAnchor: 3 })).toBeNull();
  });

  it('null explicito en los 3 campos limpia el override — valido', () => {
    expect(validatePatchBody({ bpmManual: null })).toBeNull();
    expect(validatePatchBody({ timeSignature: null })).toBeNull();
    expect(validatePatchBody({ beatAnchor: null })).toBeNull();
    expect(
      validatePatchBody({ bpmManual: null, timeSignature: null, beatAnchor: null }),
    ).toBeNull();
  });

  it('bpmManual fuera de rango 20-350 falla', () => {
    expect(validatePatchBody({ bpmManual: 19 })).toMatch(/bpmManual/);
    expect(validatePatchBody({ bpmManual: 351 })).toMatch(/bpmManual/);
    expect(validatePatchBody({ bpmManual: NaN })).toMatch(/bpmManual/);
    expect(validatePatchBody({ bpmManual: 'nope' })).toMatch(/bpmManual/);
  });

  it('bpmManual en los limites 20 y 350 pasa (inclusive)', () => {
    expect(validatePatchBody({ bpmManual: 20 })).toBeNull();
    expect(validatePatchBody({ bpmManual: 350 })).toBeNull();
  });

  it('timeSignature invalido falla', () => {
    expect(validatePatchBody({ timeSignature: '5/4' })).toMatch(/timeSignature/);
  });

  it('timeSignature valido pasa (4/4, 3/4, 6/8, 2/4)', () => {
    for (const ts of ['4/4', '3/4', '6/8', '2/4']) {
      expect(validatePatchBody({ timeSignature: ts })).toBeNull();
    }
  });

  it('beatAnchor invalido falla (float, 0, 13, string)', () => {
    expect(validatePatchBody({ beatAnchor: 1.5 })).toMatch(/beatAnchor/);
    expect(validatePatchBody({ beatAnchor: 0 })).toMatch(/beatAnchor/);
    expect(validatePatchBody({ beatAnchor: 13 })).toMatch(/beatAnchor/);
    expect(validatePatchBody({ beatAnchor: '3' })).toMatch(/beatAnchor/);
  });

  it('beatAnchor en los limites 1 y 12 pasa (inclusive)', () => {
    expect(validatePatchBody({ beatAnchor: 1 })).toBeNull();
    expect(validatePatchBody({ beatAnchor: 12 })).toBeNull();
  });

  it('body vacio falla — nada que actualizar', () => {
    expect(validatePatchBody({})).toMatch(/sin campos/);
  });

  it('body con solo claves desconocidas falla — nada que actualizar', () => {
    expect(validatePatchBody({ foo: 1 })).toMatch(/sin campos/);
  });

  it('{ bpmManual: undefined } explicito cae en "sin campos" (equivale a ausente)', () => {
    expect(validatePatchBody({ bpmManual: undefined })).toMatch(/sin campos/);
  });

  it('body array falla (Array.isArray guard)', () => {
    expect(validatePatchBody([])).toMatch(/body/);
    expect(validatePatchBody([{ bpmManual: 100 }])).toMatch(/body/);
  });

  it('body no-objeto falla', () => {
    expect(validatePatchBody(null)).toBeTruthy();
    expect(validatePatchBody(undefined)).toBeTruthy();
    expect(validatePatchBody('nope')).toBeTruthy();
  });
});
