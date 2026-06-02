import { describe, it, expect } from 'vitest';
import { buildLetraLineHTML } from '../src/lib/lyricsRender.js';
import { transposeChord, buildChordsLineHTML } from '../src/lib/lyricsRender.js';

describe('buildLetraLineHTML', () => {
  it('devuelve texto escapado plano, sin wrappers ni color', () => {
    expect(buildLetraLineHTML('Santo es el Señor')).toBe('Santo es el Señor');
  });

  it('escapa HTML', () => {
    expect(buildLetraLineHTML('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });

  it('tolera vacío/undefined', () => {
    expect(buildLetraLineHTML('')).toBe('');
    expect(buildLetraLineHTML(undefined)).toBe('');
  });
});

describe('transposeChord', () => {
  it('sube semitonos (sostenidos)', () => {
    expect(transposeChord('C', 2, false)).toBe('D');
    expect(transposeChord('A', 1, false)).toBe('A#');
  });
  it('usa bemoles cuando useFlats', () => {
    expect(transposeChord('A', 1, true)).toBe('Bb');
  });
  it('conserva el sufijo del acorde', () => {
    expect(transposeChord('Cm7', 2, false)).toBe('Dm7');
  });
  it('semitonos 0 devuelve igual', () => {
    expect(transposeChord('G', 0, false)).toBe('G');
  });
});

describe('buildChordsLineHTML', () => {
  // visibleText: texto sin tags — la letra (sin las etiquetas flotantes) no debe partirse.
  const lyricsOnly = (html) =>
    html.replace(/<span class="float-label[^"]*">[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '');

  it('acorde flota sin partir la palabra', () => {
    const html = buildChordsLineHTML('universo', [{ pos: 0, ch: 'D' }]);
    expect(html).toContain('float-label chord-label');
    expect(html).toContain('>D<');
    expect(lyricsOnly(html)).toBe('universo');
  });

  it('atenúa la letra con baseClass lyrics__letra-dim', () => {
    const html = buildChordsLineHTML('Santo', [{ pos: 0, ch: 'D' }]);
    expect(html).toContain('lyrics__letra-dim');
  });

  it('transpone el acorde', () => {
    const html = buildChordsLineHTML('Santo', [{ pos: 0, ch: 'C' }], {
      transposeSemitones: 2,
      useFlats: false,
    });
    expect(html).toContain('>D<');
  });

  it('línea sin acordes → letra atenuada continua sin partir', () => {
    const html = buildChordsLineHTML('del universo', []);
    expect(lyricsOnly(html)).toBe('del universo');
  });

  it('clampa pos al final del texto', () => {
    const html = buildChordsLineHTML('ab', [{ pos: 99, ch: 'G' }]);
    expect(html).toContain('>G<');
  });
});
