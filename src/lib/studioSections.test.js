import { describe, it, expect } from 'vitest';
import { SECTION_KEYS, sectionLabel, sectionState } from './studioSections.js';

describe('studioSections', () => {
  it('etiquetas ES por sección', () => {
    expect(sectionLabel('voiceInstrumental')).toBe('Voz e instrumentos');
    expect(sectionLabel('structure')).toBe('Secciones');
    expect(sectionLabel('leadBacking')).toBe('Voz líder y coros');
    expect(sectionLabel('gender')).toBe('Voces por género');
  });

  it('sectionState mapea estado a etiqueta', () => {
    expect(sectionState({ status: 'pending' }).status).toBe('pending');
    expect(sectionState({ status: 'running' }).label).toBe('Separando…');
    expect(sectionState({ status: 'done' }).label).toBe('Listo');
    expect(sectionState({ status: 'failed' }).label).toBe('Error');
    expect(sectionState({ status: 'skipped' }).label).toBe('No procesada');
  });

  it('SECTION_KEYS tiene exactamente los 4 bloques en el orden canónico', () => {
    expect(SECTION_KEYS).toEqual(['voiceInstrumental', 'structure', 'leadBacking', 'gender']);
  });
});
