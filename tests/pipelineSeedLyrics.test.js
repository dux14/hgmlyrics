import { describe, it, expect } from 'vitest';
import {
  seedIndex,
  monotonicAlign,
  compareScore,
  buildTextSuggestions,
} from '../api/_lib/pipeline/seedLyrics.js';

const SEED = [
  { type: 'verse', lines: [{ text: 'Primero el cielo' }, { text: 'y lo demás está de más' }] },
  { type: 'chorus', lines: [{ text: 'Sé que tú me cuidarás' }, { annotation: 'x2' }] },
];

describe('seedIndex', () => {
  it('aplana en el mismo orden que projectCanonicalLines, salteando annotations', () => {
    expect(seedIndex(SEED)).toEqual([
      { dbIndex: 0, sectionIdx: 0, lineIdx: 0, text: 'Primero el cielo' },
      { dbIndex: 1, sectionIdx: 0, lineIdx: 1, text: 'y lo demás está de más' },
      { dbIndex: 2, sectionIdx: 1, lineIdx: 0, text: 'Sé que tú me cuidarás' },
    ]);
  });

  it('sin semilla devuelve []', () => {
    expect(seedIndex(undefined)).toEqual([]);
  });
});

describe('monotonicAlign', () => {
  it('descarta el match espurio que rompe el orden', () => {
    const out = monotonicAlign([
      { transIndex: 0, dbIndex: 0, score: 0.95 },
      { transIndex: 1, dbIndex: 9, score: 0.55 }, // espurio, lejano
      { transIndex: 2, dbIndex: 1, score: 0.9 },
      { transIndex: 3, dbIndex: 2, score: 0.92 },
    ]);
    expect(out.map((p) => p.transIndex)).toEqual([0, 2, 3]);
  });

  it('conserva el bloque repetido (dbIndex igual no rompe monotonía)', () => {
    const out = monotonicAlign([
      { transIndex: 0, dbIndex: 3, score: 0.9 },
      { transIndex: 1, dbIndex: 3, score: 0.9 },
      { transIndex: 2, dbIndex: 4, score: 0.9 },
    ]);
    expect(out).toHaveLength(3);
  });

  it('ignora los pares sin match', () => {
    expect(monotonicAlign([{ transIndex: 0, dbIndex: null, score: 0 }])).toEqual([]);
  });
});

describe('compareScore', () => {
  it('ignora tildes, mayúsculas y puntuación', () => {
    expect(compareScore('Está de más.', 'esta de mas')).toBe(1);
  });
  it('penaliza proporcionalmente la errata', () => {
    const s = compareScore('está de mar', 'está de más');
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });
});

describe('buildTextSuggestions', () => {
  const seed = [
    { dbIndex: 0, sectionIdx: 0, lineIdx: 0, text: 'y lo demás está de más' },
  ];
  it('propone la línea de la semilla cuando hay errata', () => {
    // NOTA (Task 10): el plan usaba 'y lo demás está de mar' (1 caracter de
    // distancia sobre 22), que da score 21/22 ≈ 0.9545 — cae por encima de
    // SUGGEST_MAX_SCORE (0.95) y la guarda de "ya coincide" la descarta antes
    // de llegar al aserto. Se ajusta la errata a 2 caracteres ('mor') para
    // que el score caiga dentro de la banda de sugerencia y el test ejercite
    // la rama que dice ejercitar.
    const doc = { sections: [{ lines: [{ text: 'y lo demás está de mor' }] }] };
    expect(buildTextSuggestions(doc, seed)).toEqual([
      { section: 0, line: 0, text: 'y lo demás está de más', score: expect.any(Number) },
    ]);
  });
  it('no propone nada si el texto ya coincide', () => {
    const doc = { sections: [{ lines: [{ text: 'Y lo demás está de más' }] }] };
    expect(buildTextSuggestions(doc, seed)).toEqual([]);
  });
  it('no propone nada si el renglón no se parece a ninguna línea', () => {
    const doc = { sections: [{ lines: [{ text: 'zzz qqq' }] }] };
    expect(buildTextSuggestions(doc, seed)).toEqual([]);
  });
  it('sin semilla devuelve []', () => {
    expect(buildTextSuggestions({ sections: [{ lines: [{ text: 'a' }] }] }, [])).toEqual([]);
  });
});
