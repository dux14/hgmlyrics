import { describe, it, expect } from 'vitest';
import { isMp3File } from '../lib/studioFile.js';

describe('isMp3File', () => {
  it('acepta archivo con type audio/mpeg sin importar la extensión', () => {
    const file = { type: 'audio/mpeg', name: 'cancion' };
    expect(isMp3File(file)).toBe(true);
  });

  it('acepta archivo con nombre .MP3 en mayúsculas aunque el type sea vacío', () => {
    const file = { type: '', name: 'TRACK.MP3' };
    expect(isMp3File(file)).toBe(true);
  });

  it('acepta archivo con nombre .mp3 y type vacío (navegadores móviles)', () => {
    const file = { type: '', name: 'cancion.mp3' };
    expect(isMp3File(file)).toBe(true);
  });

  it('rechaza archivo .wav', () => {
    const file = { type: 'audio/wav', name: 'pista.wav' };
    expect(isMp3File(file)).toBe(false);
  });

  it('rechaza archivo .m4a', () => {
    const file = { type: 'audio/mp4', name: 'pista.m4a' };
    expect(isMp3File(file)).toBe(false);
  });

  it('rechaza archivo .wav con type vacío (por extensión)', () => {
    const file = { type: '', name: 'pista.wav' };
    expect(isMp3File(file)).toBe(false);
  });
});
