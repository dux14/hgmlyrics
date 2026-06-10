import { describe, it, expect } from 'vitest';
import { zipFilename } from './studioZip.js';

describe('zipFilename', () => {
  it('usa el nombre original sin extensión + label + .mp3', () => {
    expect(zipFilename('colombia.mp3', 'Batería')).toBe('colombia - Batería.mp3');
  });
  it('quita la extensión aunque sea .wav o .m4a', () => {
    expect(zipFilename('cancion.wav', 'Voz líder')).toBe('cancion - Voz líder.mp3');
  });
  it('sin extensión, usa el nombre tal cual', () => {
    expect(zipFilename('demo', 'Coros')).toBe('demo - Coros.mp3');
  });
  it('sanea caracteres ilegales de nombre de archivo en ambas partes', () => {
    expect(zipFilename('a/b:c?.mp3', 'X*Y')).toBe('a_b_c_ - X_Y.mp3');
  });
  it('cae a "audio" si el nombre original es vacío o no string', () => {
    expect(zipFilename('', 'Bajo')).toBe('audio - Bajo.mp3');
    expect(zipFilename(undefined, 'Bajo')).toBe('audio - Bajo.mp3');
  });
});
