import { describe, it, expect } from 'vitest';
import { sectionColorSlug, displayLabel } from './structureLabels.js';

describe('sectionColorSlug', () => {
  it('mapea los labels conocidos de SongFormer a su slug de color', () => {
    expect(sectionColorSlug('verso')).toBe('verse');
    expect(sectionColorSlug('coro')).toBe('chorus');
    expect(sectionColorSlug('puente')).toBe('bridge');
    expect(sectionColorSlug('intro')).toBe('intro');
    expect(sectionColorSlug('outro')).toBe('outro');
    expect(sectionColorSlug('pre-coro')).toBe('prechorus');
  });

  it('instrumental y silencio van a neutral por intención (no por coincidencia)', () => {
    expect(sectionColorSlug('instrumental')).toBe('neutral');
    expect(sectionColorSlug('silencio')).toBe('neutral');
  });

  it('label desconocido o ausente cae en neutral', () => {
    expect(sectionColorSlug('no-existe')).toBe('neutral');
    expect(sectionColorSlug(undefined)).toBe('neutral');
    expect(sectionColorSlug(null)).toBe('neutral');
  });

  it('es case-insensitive', () => {
    expect(sectionColorSlug('VERSO')).toBe('verse');
    expect(sectionColorSlug('Coro')).toBe('chorus');
  });
});

describe('displayLabel', () => {
  it('capitaliza la primera letra', () => {
    expect(displayLabel('verso')).toBe('Verso');
    expect(displayLabel('pre-coro')).toBe('Pre-coro');
  });

  it('label vacío o ausente no crashea', () => {
    expect(displayLabel('')).toBe('');
    expect(displayLabel(undefined)).toBe('');
  });
});
