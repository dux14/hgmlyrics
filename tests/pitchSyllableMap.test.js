/**
 * pitchSyllableMap.test.js — TDD del módulo puro que cruza las sílabas del
 * análisis de tono (song_pitch_analysis) con el texto del renglón en pantalla.
 * Fixtures tomados de producción (ver plan): la concatenación de sílabas
 * reconstruye el texto, con la puntuación pegada a la última sílaba.
 */
import { describe, it, expect } from 'vitest';
import { mapSyllablesToChars, noteForRange, resolveLine } from '../src/lib/pitchSyllableMap.js';

// Línea 3 de 22ac3453… (real). Notas de las 5 primeras sílabas verificadas en
// la base; la de "pre" se completa como repetición para el fixture.
const LINEA_DECISION = {
  text: 'Que esta sea siempre',
  syllables: [
    { text: 'Que', start: 22.172, end: 22.454, midi: 59, note: 'B3', cents: -7 },
    { text: 'es', start: 22.574, end: 22.715, midi: null, note: null, cents: null },
    { text: 'ta', start: 22.715, end: 22.856, midi: 59, note: null, cents: -3 },
    { text: 'sea', start: 22.956, end: 23.74, midi: 60, note: 'C4', cents: 0 },
    { text: 'siem', start: 23.861, end: 24.2, midi: 60, note: null, cents: -2 },
    { text: 'pre', start: 24.2, end: 24.4, midi: 60, note: null, cents: 0 },
  ],
};

// Línea 3 de 615652e7… (texto real, notas sintéticas): prueba la coma pegada.
const LINEA_LIO = {
  text: 'Hagan lío, dejen que el abrazo',
  syllables: [
    { text: 'Ha', midi: 59, note: 'B3' },
    { text: 'gan', midi: 59, note: null },
    { text: 'lío,', midi: 59, note: null },
    { text: 'de', midi: 61, note: 'C#4' },
    { text: 'jen', midi: 61, note: null },
    { text: 'que', midi: 61, note: null },
    { text: 'el', midi: 61, note: null },
    { text: 'abra', midi: 62, note: 'D4' },
    { text: 'zo', midi: 62, note: null },
  ],
};

describe('mapSyllablesToChars', () => {
  it('mapea cada sílaba a su rango de caracteres en el texto', () => {
    const mapped = mapSyllablesToChars(LINEA_DECISION.text, LINEA_DECISION.syllables);
    expect(mapped).not.toBeNull();
    expect(mapped.map((m) => LINEA_DECISION.text.slice(m.charStart, m.charEnd))).toEqual([
      'Que',
      'es',
      'ta',
      'sea',
      'siem',
      'pre',
    ]);
  });

  it('mantiene la puntuación pegada a la sílaba que la trae', () => {
    const mapped = mapSyllablesToChars(LINEA_LIO.text, LINEA_LIO.syllables);
    expect(mapped).not.toBeNull();
    expect(LINEA_LIO.text.slice(mapped[2].charStart, mapped[2].charEnd)).toBe('lío,');
  });

  it('resuelve el nombre de nota: propia, repetida (ditto) y en blanco', () => {
    const mapped = mapSyllablesToChars(LINEA_DECISION.text, LINEA_DECISION.syllables);
    expect(mapped.map((m) => m.note)).toEqual(['B3', null, 'B3', 'C4', 'C4', 'C4']);
    expect(mapped[1].midi).toBeNull();
  });

  it('devuelve null si el texto ya no coincide con las sílabas', () => {
    expect(mapSyllablesToChars('Que ésta sea siempre', LINEA_DECISION.syllables)).toBeNull();
    expect(mapSyllablesToChars('Que esta sea', LINEA_DECISION.syllables)).toBeNull();
  });

  it('devuelve null si sobra texto con contenido al final', () => {
    expect(mapSyllablesToChars('Que esta sea siempre mía', LINEA_DECISION.syllables)).toBeNull();
  });

  it('tolera puntuación final sin sílaba propia', () => {
    const mapped = mapSyllablesToChars('Que esta sea siempre...', LINEA_DECISION.syllables);
    expect(mapped).not.toBeNull();
    expect(mapped).toHaveLength(6);
  });

  it('da ancho cero a la sílaba extensora de melisma, sin consumir caracteres', () => {
    const syllables = [
      { text: 'oh', midi: 59, note: 'B3' },
      { text: '', midi: 60, note: 'C4' },
    ];
    const mapped = mapSyllablesToChars('oh', syllables);
    expect(mapped).toEqual([
      { charStart: 0, charEnd: 2, note: 'B3', midi: 59 },
      { charStart: 2, charEnd: 2, note: 'C4', midi: 60 },
    ]);
  });

  it('descarta la nota cuya octava el editor no acepta', () => {
    const mapped = mapSyllablesToChars('la', [{ text: 'la', midi: 116, note: null }]);
    expect(mapped[0].note).toBeNull();
    expect(mapped[0].midi).toBeNull();
  });

  it('devuelve lista vacía con entradas vacías o inválidas', () => {
    expect(mapSyllablesToChars('hola', [])).toEqual([]);
    expect(mapSyllablesToChars('hola', null)).toEqual([]);
    expect(mapSyllablesToChars(null, [])).toEqual([]);
  });
});

describe('noteForRange', () => {
  const mapped = mapSyllablesToChars(LINEA_DECISION.text, LINEA_DECISION.syllables);

  it('toma la nota de la primera sílaba con nota del rango', () => {
    // "esta sea" = caracteres 4 a 12: sílabas es (en blanco), ta (B3), sea (C4).
    expect(noteForRange(mapped, { start: 4, end: 12 })).toEqual({
      note: 'B3',
      notes: ['B3', 'C4'],
    });
  });

  it('no repite notas consecutivas iguales en el aviso', () => {
    // "sea siempre" = C4 en tres sílabas seguidas.
    expect(noteForRange(mapped, { start: 9, end: 20 })).toEqual({ note: 'C4', notes: ['C4'] });
  });

  it('devuelve una sola nota cuando el rango cae dentro de una sílaba', () => {
    expect(noteForRange(mapped, { start: 0, end: 2 })).toEqual({ note: 'B3', notes: ['B3'] });
  });

  it('toma las sílabas que el rango toca, aunque las corte a la mitad', () => {
    // "e esta s": arranca en el último carácter de "Que" y termina dentro de "sea".
    expect(noteForRange(mapped, { start: 2, end: 10 })).toEqual({
      note: 'B3',
      notes: ['B3', 'C4'],
    });
  });

  it('devuelve note null si ninguna sílaba del rango tiene nota', () => {
    const soloBlancas = mapSyllablesToChars('es', [{ text: 'es', midi: null, note: null }]);
    expect(noteForRange(soloBlancas, { start: 0, end: 2 })).toEqual({ note: null, notes: [] });
  });

  it('incluye el extensor de melisma cuya posición cae dentro del rango', () => {
    const conMelisma = mapSyllablesToChars('oh', [
      { text: 'oh', midi: null, note: null },
      { text: '', midi: 60, note: 'C4' },
    ]);
    expect(noteForRange(conMelisma, { start: 0, end: 2 })).toEqual({ note: 'C4', notes: ['C4'] });
  });

  it('es tolerante a entradas vacías', () => {
    expect(noteForRange(null, { start: 0, end: 2 })).toEqual({ note: null, notes: [] });
    expect(noteForRange(mapped, null)).toEqual({ note: null, notes: [] });
  });
});

describe('resolveLine', () => {
  const lineaOtra = {
    i: 0,
    syllables: [
      { text: 'Tan', midi: 59, note: 'B3' },
      { text: 'des', midi: 59, note: null },
      { text: 'nu', midi: 59, note: null },
      { text: 'do', midi: 59, note: null },
    ],
  };
  const lineaBuscada = { i: 0, syllables: LINEA_DECISION.syllables };

  it('usa el índice canónico cuando el texto de esa línea calza', () => {
    const lines = [lineaOtra, lineaOtra, lineaBuscada];
    const res = resolveLine(LINEA_DECISION.text, 2, lines);
    expect(res.lineIndex).toBe(2);
    expect(res.exact).toBe(true);
    expect(res.mapped).toHaveLength(6);
  });

  it('cae al texto cuando el índice canónico no calza (análisis desalineado)', () => {
    const lines = [lineaOtra, lineaBuscada, lineaOtra];
    const res = resolveLine(LINEA_DECISION.text, 0, lines);
    expect(res.lineIndex).toBe(1);
    expect(res.exact).toBe(false);
  });

  it('con el renglón repetido, resuelve al más cercano al índice esperado', () => {
    const lines = [lineaBuscada, lineaOtra, lineaOtra, lineaBuscada];
    expect(resolveLine(LINEA_DECISION.text, 3, lines).lineIndex).toBe(3);
    expect(resolveLine(LINEA_DECISION.text, 1, lines).lineIndex).toBe(0);
  });

  it('ante empate de distancia toma el índice menor', () => {
    const lines = [lineaBuscada, lineaOtra, lineaBuscada];
    expect(resolveLine(LINEA_DECISION.text, 1, lines).lineIndex).toBe(0);
  });

  it('devuelve null si ninguna línea del análisis calza', () => {
    expect(resolveLine('Un renglón que nadie cantó', 0, [lineaOtra])).toBeNull();
  });

  it('devuelve null con entradas vacías', () => {
    expect(resolveLine(LINEA_DECISION.text, 0, [])).toBeNull();
    expect(resolveLine(LINEA_DECISION.text, 0, null)).toBeNull();
    expect(resolveLine('', 0, [lineaOtra])).toBeNull();
  });

  it('tolera un índice canónico fuera de rango', () => {
    const res = resolveLine(LINEA_DECISION.text, 99, [lineaBuscada]);
    expect(res.lineIndex).toBe(0);
    expect(res.exact).toBe(false);
  });

  it('una línea del análisis sin sílabas no gana por índice: mapSyllablesToChars devuelve [] (truthy) pero no calza con ningún texto', () => {
    const lineaSinSilabas = { i: 0, syllables: [] };
    const lines = [lineaSinSilabas, lineaBuscada];
    const res = resolveLine(LINEA_DECISION.text, 0, lines);
    expect(res.lineIndex).toBe(1);
    expect(res.exact).toBe(false);
  });

  it('si ninguna línea calza, un análisis sin sílabas en el índice canónico no impide devolver null', () => {
    const lineaSinSilabas = { i: 0, syllables: [] };
    expect(resolveLine(LINEA_DECISION.text, 0, [lineaSinSilabas])).toBeNull();
  });
});
