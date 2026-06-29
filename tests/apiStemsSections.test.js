import { describe, it, expect } from 'vitest';
import { initSections, applySectionResult, deriveJobStatus, validateEnabledSections } from '../api/stems/_sections.js';

describe('sections', () => {
  it('initSections crea las 4 en pending con gender.enabled=false', () => {
    const s = initSections(['voiceInstrumental','structure','leadBacking']);
    expect(Object.keys(s)).toEqual(['voiceInstrumental','structure','leadBacking','gender']);
    expect(s.voiceInstrumental.status).toBe('pending');
    expect(s.gender.enabled).toBe(false);
    expect(s.leadBacking.enabled).toBe(true);
  });
  it('applySectionResult marca done e idempotente', () => {
    let s = initSections(['voiceInstrumental']);
    s = applySectionResult(s, 'voiceInstrumental', { status:'done', model:'demucs', outputs:{ vocals:'k' } });
    expect(s.voiceInstrumental.status).toBe('done');
    expect(s.voiceInstrumental.outputs.vocals).toBe('k');
    const again = applySectionResult(s, 'voiceInstrumental', { status:'done', model:'demucs', outputs:{ vocals:'k' } });
    expect(again).toEqual(s); // idempotente
  });
  it('deriveJobStatus: todas done -> done; mezcla done/failed -> partial; alguna running -> processing', () => {
    const s = initSections(['voiceInstrumental','structure']);
    expect(deriveJobStatus(s)).toBe('processing');
    s.voiceInstrumental.status='done'; s.structure.status='done'; s.leadBacking.status='skipped'; s.gender.status='skipped';
    expect(deriveJobStatus(s)).toBe('done');
    s.structure.status='failed';
    expect(deriveJobStatus(s)).toBe('partial');
  });
});

describe('validateEnabledSections', () => {
  it('devuelve el subconjunto saneado en orden canonico', () => {
    expect(validateEnabledSections(['leadBacking', 'voiceInstrumental'], { genderEnabled: true }))
      .toEqual(['voiceInstrumental', 'leadBacking']);
  });
  it('dedup de claves repetidas', () => {
    expect(validateEnabledSections(['structure', 'structure'], { genderEnabled: true }))
      .toEqual(['structure']);
  });
  it('elimina gender silenciosamente si genderEnabled=false', () => {
    expect(validateEnabledSections(['voiceInstrumental', 'gender'], { genderEnabled: false }))
      .toEqual(['voiceInstrumental']);
  });
  it('conserva gender si genderEnabled=true', () => {
    expect(validateEnabledSections(['gender'], { genderEnabled: true })).toEqual(['gender']);
  });
  it('lanza 400 si queda vacio', () => {
    expect(() => validateEnabledSections([], { genderEnabled: true })).toThrow();
    try {
      validateEnabledSections([], { genderEnabled: true });
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });
  it('lanza 400 si todas las claves son invalidas', () => {
    expect(() => validateEnabledSections(['noExiste'], { genderEnabled: true })).toThrow();
  });
  it('lanza 400 si input no es array', () => {
    expect(() => validateEnabledSections('voiceInstrumental', { genderEnabled: true })).toThrow();
    expect(() => validateEnabledSections(undefined, { genderEnabled: true })).toThrow();
  });
  it('lanza 400 si gender es la única sección y opts omitido', () => {
    expect(() => validateEnabledSections(['gender'])).toThrow();
  });
  it('lanza 400 si input es null', () => {
    expect(() => validateEnabledSections(null, { genderEnabled: true })).toThrow();
  });
});
