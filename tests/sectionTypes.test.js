import { describe, it, expect } from 'vitest';
import {
  normalizeSectionType,
  KNOWN_SECTION_TYPES,
  SECTION_TYPE_ALIASES,
  SECTION_TYPE_LABELS,
} from '../src/lib/sectionTypes.js';

describe('sectionTypes (módulo compartido SongView/ImmersiveView)', () => {
  it('normaliza slugs conocidos tal cual', () => {
    for (const slug of KNOWN_SECTION_TYPES) {
      expect(normalizeSectionType(slug)).toBe(slug);
    }
  });

  it('normaliza alias español/legacy a su slug', () => {
    for (const [alias, slug] of Object.entries(SECTION_TYPE_ALIASES)) {
      expect(normalizeSectionType(alias)).toBe(slug);
    }
  });

  it('tipos desconocidos caen a verse', () => {
    expect(normalizeSectionType('lo-que-sea')).toBe('verse');
    expect(normalizeSectionType()).toBe('verse');
  });

  it('es case/espacio insensible', () => {
    expect(normalizeSectionType('  CORO  ')).toBe('chorus');
  });

  it('tiene una etiqueta española por cada slug conocido', () => {
    for (const slug of KNOWN_SECTION_TYPES) {
      expect(SECTION_TYPE_LABELS[slug]).toBeTruthy();
    }
  });

  it('reconoce instrumental como tipo propio, no lo degrada a verse', () => {
    expect(KNOWN_SECTION_TYPES).toContain('instrumental');
    expect(normalizeSectionType('instrumental')).toBe('instrumental');
    expect(SECTION_TYPE_LABELS.instrumental).toBe('INSTRUMENTAL');
  });
});
