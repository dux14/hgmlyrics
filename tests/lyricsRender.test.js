import { describe, it, expect } from 'vitest';
import { buildLetraLineHTML } from '../src/lib/lyricsRender.js';
import { transposeChord, transposeNote, buildChordsLineHTML } from '../src/lib/lyricsRender.js';
import { buildTonoLineHTML } from '../src/lib/lyricsRender.js';

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

describe('buildTonoLineHTML', () => {
  const line = {
    text: 'Santo es el Señor',
    groups: [{ start: 0, end: 5, voiceId: 'sop1', note: 'B3' }],
  };
  const lyricsOnly = (html) =>
    html.replace(/<span class="float-label[^"]*">[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '');

  it('la letra cantada de la voz activa va neutra (lyrics__tono-sung), no con el color de voz', () => {
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano');
    expect(html).toContain('line-seg lyrics__tono-sung');
    expect(html).not.toContain('line-seg voice-text--soprano');
  });

  it('la nota flota con el color de la voz y la clase de tamaño/fondo tono-note', () => {
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano');
    expect(html).toContain('float-label voice-text--soprano tono-note');
    expect(html).toContain('>B3<');
  });

  it('atenúa con lyrics__tono-dim lo que la voz activa NO canta', () => {
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano');
    expect(html).toContain('lyrics__tono-dim');
  });

  it('no parte la letra', () => {
    const html = buildTonoLineHTML(line, 'sop1', 'voice-text--soprano');
    expect(lyricsOnly(html)).toBe('Santo es el Señor');
  });

  it('grupo sin nota: marca el rango con pending + color de voz, sin nota flotante', () => {
    const l = { text: 'abcd', groups: [{ start: 0, end: 2, voiceId: 'sop1', note: null }] };
    const html = buildTonoLineHTML(l, 'sop1', 'voice-text--soprano');
    expect(html).toContain('lyrics__tono-pending voice-text--soprano');
    expect(html).not.toContain('float-label');
  });

  it('voz que no canta en la línea → todo atenuado, sin color ni notas', () => {
    const html = buildTonoLineHTML(line, 'ten1', 'voice-text--tenor');
    expect(html).not.toContain('float-label');
    expect(html).not.toContain('voice-text--tenor');
    expect(html).toContain('lyrics__tono-dim');
    expect(lyricsOnly(html)).toBe('Santo es el Señor');
  });
});

describe('transposeNote', () => {
  it('sube semitonos dentro de la octava', () => {
    expect(transposeNote('A3', 2, false)).toBe('B3');
  });
  it('cruza la frontera de octava hacia arriba (B3 +1 → C4)', () => {
    expect(transposeNote('B3', 1, false)).toBe('C4');
  });
  it('cruza la frontera de octava hacia abajo (C3 −1 → B2)', () => {
    expect(transposeNote('C3', -1, false)).toBe('B2');
  });
  it('usa bemoles cuando useFlats', () => {
    expect(transposeNote('A3', 1, true)).toBe('Bb3');
  });
  it('normaliza bemoles de entrada', () => {
    expect(transposeNote('Bb3', 2, false)).toBe('C4');
  });
  it('semitonos 0 devuelve igual', () => {
    expect(transposeNote('F#3', 0, false)).toBe('F#3');
  });
  it('entrada inválida pasa intacta', () => {
    expect(transposeNote('xx', 2, false)).toBe('xx');
    expect(transposeNote('', 2, false)).toBe('');
  });
  it('salto de octava completa ±12', () => {
    expect(transposeNote('A3', 12, false)).toBe('A4');
    expect(transposeNote('A3', -12, false)).toBe('A2');
  });
  it('cruce doble hacia abajo (C3 −13 → B1)', () => {
    expect(transposeNote('C3', -13, false)).toBe('B1');
  });
});

describe('buildTonoLineHTML — pending (grupo sin nota)', () => {
  const line = {
    text: 'San to canta',
    groups: [
      { voiceId: 'v1', start: 0, end: 3, note: 'B3' },
      { voiceId: 'v1', start: 4, end: 6, note: null },
    ],
  };
  it('grupo con nota → lyrics__tono-sung + nota flotante', () => {
    const html = buildTonoLineHTML(line, 'v1', 'voice-text--tenor');
    expect(html).toContain('lyrics__tono-sung');
    expect(html).toContain('tono-note');
    expect(html).toContain('B3');
  });
  it('grupo sin nota → lyrics__tono-pending + clase de color de voz, sin nota flotante', () => {
    const html = buildTonoLineHTML(line, 'v1', 'voice-text--tenor');
    expect(html).toContain('lyrics__tono-pending voice-text--tenor');
    const pendingSeg = html.split('<span class="line-seg').find((s) => s.includes('tono-pending'));
    expect(pendingSeg).not.toContain('float-label');
  });
  it('texto fuera de grupos sigue dim', () => {
    const html = buildTonoLineHTML(line, 'v1', 'voice-text--tenor');
    expect(html).toContain('lyrics__tono-dim');
  });
});
