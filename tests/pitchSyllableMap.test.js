/**
 * pitchSyllableMap.test.js — TDD del módulo puro que cruza las sílabas del
 * análisis de tono (song_pitch_analysis) con el texto del renglón en pantalla.
 * Fixtures tomados de producción (ver plan): la concatenación de sílabas
 * reconstruye el texto, con la puntuación pegada a la última sílaba.
 */
import { describe, it, expect } from 'vitest';
import { mapSyllablesToChars } from '../src/lib/pitchSyllableMap.js';

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
