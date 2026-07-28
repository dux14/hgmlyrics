import { describe, it, expect } from 'vitest';
import { initSections, applySectionResult, deriveJobStatus, validateEnabledSections } from '../api/stems/_sections.js';

describe('sections', () => {
  it('initSections crea las 5 en pending con gender/duet.enabled=false', () => {
    const s = initSections(['voiceInstrumental','structure','leadBacking']);
    expect(Object.keys(s)).toEqual(['voiceInstrumental','structure','leadBacking','gender','duet']);
    expect(s.voiceInstrumental.status).toBe('pending');
    expect(s.gender.enabled).toBe(false);
    expect(s.duet.enabled).toBe(false);
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
    expect(validateEnabledSections(['leadBacking', 'voiceInstrumental']))
      .toEqual(['voiceInstrumental', 'leadBacking']);
  });
  it('dedup de claves repetidas', () => {
    expect(validateEnabledSections(['structure', 'structure']))
      .toEqual(['structure']);
  });
  it('conserva gender: ya no depende de ningun flag', () => {
    expect(validateEnabledSections(['voiceInstrumental', 'gender']))
      .toEqual(['voiceInstrumental', 'gender']);
    expect(validateEnabledSections(['gender'])).toEqual(['gender']);
  });
  it('lanza 400 si queda vacio', () => {
    expect(() => validateEnabledSections([])).toThrow();
    try {
      validateEnabledSections([]);
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });
  it('lanza 400 si todas las claves son invalidas', () => {
    expect(() => validateEnabledSections(['noExiste'])).toThrow();
  });
  it('lanza 400 si input no es array', () => {
    expect(() => validateEnabledSections('voiceInstrumental')).toThrow();
    expect(() => validateEnabledSections(undefined)).toThrow();
  });
  it('lanza 400 si input es null', () => {
    expect(() => validateEnabledSections(null)).toThrow();
  });
});
