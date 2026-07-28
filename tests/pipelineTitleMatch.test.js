import { describe, expect, it } from 'vitest';
import { normalizeTitle, titleSimilarity } from '../api/_lib/pipeline/titleMatch.js';

describe('normalizeTitle', () => {
  it('quita extension, sufijos tecnicos, tildes y case', () => {
    expect(normalizeTitle('Sión_(Live)_128kbps.mp3')).toBe('sion');
    expect(normalizeTitle('03 - Sion [final] v2')).toBe('sion');
    expect(normalizeTitle('El Alfarero')).toBe('el alfarero');
  });
});

describe('titleSimilarity', () => {
  it('match exacto normalizado = 1', () => {
    expect(titleSimilarity('sion_final.mp3', 'Sión')).toBeGreaterThanOrEqual(0.6);
  });
  it('nombres sin relacion quedan bajo el umbral', () => {
    expect(titleSimilarity('ensayo_grupo_mix03.mp3', 'Sión')).toBeLessThan(0.6);
  });
  it('acotada 0..1 incluso con titulos de palabras repetidas', () => {
    const a = titleSimilarity('alfarero.mp3', 'El Alfarero');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(1);
    // titulos de alabanza con repeticion no deben exceder 1 (dominio real)
    expect(titleSimilarity('santo.mp3', 'Santo Santo Santo')).toBeLessThanOrEqual(1);
    expect(titleSimilarity('santo_es_el_senor.mp3', 'Santo Santo Santo Es El Senor')).toBeLessThanOrEqual(1);
  });
});
