import { describe, it, expect } from 'vitest';
import { buildVoiceRows } from '../src/components/VoiceSheet.js';

describe('buildVoiceRows', () => {
  it('devuelve categorías presentes en orden SATB, sin duplicar', () => {
    const song = { voiceRoster: [
      { id: '1', category: 'tenor' },
      { id: '2', category: 'soprano' },
      { id: '3', category: 'tenor' },
    ] };
    expect(buildVoiceRows(song).map((r) => r.category)).toEqual(['soprano', 'tenor']);
  });
  it('cada fila trae label y colorVar', () => {
    const [row] = buildVoiceRows({ voiceRoster: [{ id: '1', category: 'bass' }] });
    expect(row).toEqual({ category: 'bass', label: 'Bajo', colorVar: '--color-voice-bass' });
  });
  it('tolera roster vacío o ausente', () => {
    expect(buildVoiceRows({})).toEqual([]);
    expect(buildVoiceRows(null)).toEqual([]);
  });
});
