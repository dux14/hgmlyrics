import { describe, it, expect } from 'vitest';
import { initSections, applySectionResult, deriveJobStatus } from '../api/stems/_sections.js';

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
