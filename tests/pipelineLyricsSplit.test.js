import { describe, it, expect } from 'vitest';
import {
  splitAtSectionBoundaries,
  splitBySeed,
  splitLineAtWord,
  splitWordAtChar,
  splitLineByText,
  SEED_INHERIT_MIN_SCORE,
} from '../api/_lib/pipeline/lyricsSplit.js';

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

describe('splitWordAtChar', () => {
  it('reparte proporcional a caracteres y hereda el score en ambas mitades', () => {
    // Caso del spec: "primero" 1200->1550 (350ms), corte tras "prime" (5 de 7).
    const word = { word: 'primero', startMs: 1200, endMs: 1550, score: 0.87 };
    const [first, second] = splitWordAtChar(word, 5);
    expect(first).toEqual({ word: 'prime', startMs: 1200, endMs: 1450, score: 0.87 });
    expect(second).toEqual({ word: 'ro', startMs: 1450, endMs: 1550, score: 0.87 });
  });

  it('offset 0 lanza RangeError', () => {
    const word = { word: 'primero', startMs: 1200, endMs: 1550, score: 0.87 };
    expect(() => splitWordAtChar(word, 0)).toThrow(RangeError);
  });

  it('offset al final de la palabra lanza RangeError', () => {
    const word = { word: 'primero', startMs: 1200, endMs: 1550, score: 0.87 };
    expect(() => splitWordAtChar(word, 7)).toThrow(RangeError);
  });
});

describe('splitLineByText', () => {
  it('sin \\n equivale a editLine (arreglo de una pieza): cambia solo el texto, conserva lo demás', () => {
    const l = line('primero el cielo', [[1200, 1450], [1500, 1700], [1800, 2100]]);
    l.manualStartMs = 900;
    l.breath = true;
    const editLineEquivalent = { ...l, text: 'primero el cielo y lo demás' };
    expect(splitLineByText(l, 'primero el cielo y lo demás')).toEqual([editLineEquivalent]);
  });

  it('sin \\n con texto solo espacios lanza RangeError (setLineText vacío)', () => {
    const l = line('primero el cielo', [[1200, 1450], [1500, 1700], [1800, 2100]]);
    expect(() => splitLineByText(l, '   ')).toThrow(RangeError);
  });

  describe('un \\n en frontera de palabra es idéntico a splitLineAtWord', () => {
    const l = line('primero el cielo y lo demás', [
      [1200, 1450], [1500, 1700], [1800, 2100], [2200, 2400], [2500, 2600], [2700, 3000],
    ]);
    const viaWord = splitLineAtWord(l, 2);

    it('con espacio antes del \\n', () => {
      expect(splitLineByText(l, 'primero el cielo \ny lo demás')).toEqual(viaWord);
    });

    it('con espacio después del \\n', () => {
      expect(splitLineByText(l, 'primero el cielo\n y lo demás')).toEqual(viaWord);
    });

    it('con \\r\\n (sin espacio real adyacente)', () => {
      expect(splitLineByText(l, 'primero el cielo\r\ny lo demás')).toEqual(viaWord);
    });

    it('con \\n que se come el espacio de frontera (sin espacio real en ningún lado)', () => {
      // Sin espacio adyacente, la hipótesis de frontera igual gana porque el
      // \n ya es whitespace para el regex y el conteo de tokens da igual que
      // words.length -- no hace falta que sobreviva un espacio literal.
      expect(splitLineByText(l, 'primero el cielo\ny lo demás')).toEqual(viaWord);
    });
  });

  it('un \\n dentro de una palabra reparte proporcional a caracteres', () => {
    // Mismo caso del spec: "primero" 1200->1550, corte tras "prime".
    const l = line('primero', [[1200, 1550]]);
    const out = splitLineByText(l, 'prime\nro');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ text: 'prime', startMs: 1200, endMs: 1450 });
    expect(out[0].words).toEqual([{ word: 'prime', startMs: 1200, endMs: 1450, score: 0.9 }]);
    expect(out[1]).toMatchObject({ text: 'ro', startMs: 1450, endMs: 1550 });
    expect(out[1].words).toEqual([{ word: 'ro', startMs: 1450, endMs: 1550, score: 0.9 }]);
  });

  it('N saltos en una operación producen N+1 piezas', () => {
    const l = line('uno dos tres cuatro', [
      [1000, 1100], [1200, 1300], [1400, 1500], [1600, 1700],
    ]);
    const out = splitLineByText(l, 'uno\ndos\ntres\ncuatro');
    expect(out).toHaveLength(4);
    expect(out.map((p) => p.text)).toEqual(['uno', 'dos', 'tres', 'cuatro']);
  });

  it('conteo de tokens distinto al de words: piezas sin words, confidence null, vocalización derivada', () => {
    const l = line('primero el cielo', [[1200, 1450], [1500, 1700], [1800, 2100]]);
    const out = splitLineByText(l, 'primero el gran\ncielo azul');
    expect(out).toHaveLength(2);
    for (const piece of out) {
      expect(piece.words).toEqual([]);
      expect(piece.confidence).toBeNull();
      expect(piece.vocalization).toBe(true);
    }
  });

  it('saltos consecutivos y espacios colapsan: nunca se crea una pieza vacía', () => {
    const l = line('primero el cielo', [[1200, 1450], [1500, 1700], [1800, 2100]]);
    const out = splitLineByText(l, 'primero\n\n  \nel cielo');
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.text)).toEqual(['primero', 'el cielo']);
    expect(out.every((p) => p.text.length > 0)).toBe(true);
  });

  it('manualStartMs va a la primera pieza, breath a la última, el resto en false/null', () => {
    const l = line('uno dos tres', [[1000, 1100], [1200, 1300], [1400, 1500]]);
    l.manualStartMs = 950;
    l.breath = true;
    const out = splitLineByText(l, 'uno\ndos\ntres');
    expect(out[0].manualStartMs).toBe(950);
    expect(out[1].manualStartMs).toBeNull();
    expect(out[2].manualStartMs).toBeNull();
    expect(out[0].breath).toBe(false);
    expect(out[1].breath).toBe(false);
    expect(out[2].breath).toBe(true);
  });

  it('\\n al inicio colapsa a una sola pieza (arreglo de longitud 1)', () => {
    const l = line('primero el cielo', [[1200, 1450], [1500, 1700], [1800, 2100]]);
    const out = splitLineByText(l, '\nprimero el cielo');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('primero el cielo');
    expect(out[0].words).toEqual(l.words);
  });

  it('\\n al final colapsa a una sola pieza (arreglo de longitud 1)', () => {
    const l = line('primero el cielo', [[1200, 1450], [1500, 1700], [1800, 2100]]);
    const out = splitLineByText(l, 'primero el cielo\n');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('primero el cielo');
    expect(out[0].words).toEqual(l.words);
  });
});
