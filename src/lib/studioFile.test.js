import { describe, it, expect } from 'vitest';
import { deriveTitleFromFilename } from './studioFile.js';

describe('deriveTitleFromFilename', () => {
  it('quita la extensión', () => {
    expect(deriveTitleFromFilename('colombia.mp3')).toBe('colombia');
  });
  it('quita la extensión aunque sea .WAV en mayúsculas', () => {
    expect(deriveTitleFromFilename('Tema.WAV')).toBe('Tema');
  });
  it('recorta espacios', () => {
    expect(deriveTitleFromFilename('  cancion.mp3  ')).toBe('cancion');
  });
  it('cadena vacía o no-string → ""', () => {
    expect(deriveTitleFromFilename('')).toBe('');
    expect(deriveTitleFromFilename(undefined)).toBe('');
  });
  it('recorta a 120 caracteres', () => {
    expect(deriveTitleFromFilename('x'.repeat(200) + '.mp3').length).toBe(120);
  });
});
