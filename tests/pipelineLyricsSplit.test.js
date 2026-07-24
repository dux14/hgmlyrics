import { describe, it, expect } from 'vitest';
import { splitAtSectionBoundaries } from '../api/_lib/pipeline/lyricsSplit.js';

const line = (text, words) => ({
  text,
  startMs: words[0][0],
  endMs: words[words.length - 1][1],
  words: words.map(([startMs, endMs], k) => ({
    word: text.split(/\s+/)[k], startMs, endMs, score: 0.9,
  })),
  confidence: 0.9,
  vocalization: false,
  breath: false,
  manualStartMs: null,
});

// Caso real del run: secciones 3 (28.2-42.1 s) y 4 (42.1-58.2 s).
const SECTIONS = [
  { type: 'chorus', label: null, startMs: 28200, endMs: 42100, lines: [] },
  { type: 'verse', label: null, startMs: 42100, endMs: 58200, lines: [] },
];

describe('splitAtSectionBoundaries', () => {
  it('parte el renglón que cruza la frontera, en la palabra exacta', () => {
    const l = line('sé que tú me cuidarás quiero escuchar tu voz', [
      [39000, 39300], [39400, 39700], [39800, 40000], [40100, 40300], [40400, 41000],
      [42500, 42900], [43000, 43600], [43700, 43900], [44000, 44400],
    ]);
    const out = splitAtSectionBoundaries(l, SECTIONS);
    expect(out.map((x) => x.text)).toEqual([
      'sé que tú me cuidarás',
      'quiero escuchar tu voz',
    ]);
    expect(out[0].endMs).toBe(41000);
    expect(out[1].startMs).toBe(42500);
  });

  it('no parte un renglón contenido en una sola sección', () => {
    const l = line('el cielo y lo demás', [
      [31660, 32000], [32100, 32400], [32500, 32700], [32800, 33100], [33200, 33800],
    ]);
    expect(splitAtSectionBoundaries(l, SECTIONS)).toHaveLength(1);
  });

  it('sin words alineadas a los tokens no parte', () => {
    const l = line('texto editado a mano', [[39000, 39300], [39400, 39700]]);
    l.text = 'texto editado a mano por el admin';
    expect(splitAtSectionBoundaries(l, SECTIONS)).toHaveLength(1);
  });
});
