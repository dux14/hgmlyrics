import { describe, it, expect } from 'vitest';
import { splitAtSectionBoundaries, splitBySeed, SEED_INHERIT_MIN_SCORE } from '../api/_lib/pipeline/lyricsSplit.js';

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

describe('splitBySeed', () => {
  const seed = [
    { dbIndex: 0, sectionIdx: 0, lineIdx: 0, text: 'Primero el cielo' },
    { dbIndex: 1, sectionIdx: 0, lineIdx: 1, text: 'y lo demás está de más' },
  ];

  it('parte el renglón en la frontera entre dos líneas de la semilla', () => {
    // 9 tokens -> 9 words alineadas (la mismatch words/tokens desactiva el corte).
    const l = line('primero el cielo y lo demás está de mar', [
      [1000, 1300], [1400, 1600], [1700, 2000], [2100, 2300], [2400, 2600],
      [2700, 2900], [3000, 3300], [3400, 3900], [4000, 4300],
    ]);
    const out = splitBySeed(l, { dbIndex: 0, score: 0.9 }, seed);
    expect(out.map((x) => x.text)).toEqual([
      'primero el cielo',
      'y lo demás está de mar',
    ]);
  });

  it('bajo el umbral de score no hereda nada', () => {
    const l = line('algo que no se parece', [
      [1000, 1300], [1400, 1600], [1700, 2000], [2100, 2300], [2400, 2600],
    ]);
    const out = splitBySeed(l, { dbIndex: 0, score: SEED_INHERIT_MIN_SCORE - 0.1 }, seed);
    expect(out).toHaveLength(1);
  });

  it('sin semilla devuelve el renglón intacto', () => {
    const l = line('primero el cielo', [[1000, 1300], [1400, 1600], [1700, 2000]]);
    expect(splitBySeed(l, null, [])).toHaveLength(1);
  });

  // Blocker tanda C, hallazgo 2: cada pieza debe etiquetarse con la sección
  // de la línea de semilla que REALMENTE consumió (match.dbIndex + posición
  // de la pieza), no con la del match original fijo -- si no, un renglón que
  // cubre dos líneas de secciones distintas etiqueta ambas con la primera.
  it('etiqueta cada pieza con el sectionIdx de la línea de semilla que consumió, no el de match.dbIndex fijo', () => {
    const seedTwoSections = [
      { dbIndex: 0, sectionIdx: 0, lineIdx: 0, text: 'primero el cielo' },
      { dbIndex: 1, sectionIdx: 1, lineIdx: 0, text: 'y lo demás está de mar' },
    ];
    const l = line('primero el cielo y lo demás está de mar', [
      [1000, 1300], [1400, 1600], [1700, 2000], [2100, 2300], [2400, 2600],
      [2700, 2900], [3000, 3300], [3400, 3800], [3900, 4200],
    ]);
    const out = splitBySeed(l, { dbIndex: 0, score: 0.9 }, seedTwoSections);
    expect(out.map((p) => p.text)).toEqual(['primero el cielo', 'y lo demás está de mar']);
    expect(out.map((p) => p.seedSectionIdx)).toEqual([0, 1]);
  });
});
