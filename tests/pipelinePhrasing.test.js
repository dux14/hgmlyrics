import { describe, expect, it } from 'vitest';
import { suggestLineBreaks, BREATH_GAP_MS } from '../api/_lib/pipeline/phrasing.js';

// words: [{ word, startMs, endMs }] de UNA linea; devuelve indices de palabra
// DESPUES de las cuales se sugiere dividir.
describe('suggestLineBreaks', () => {
  const w = (word, startMs, endMs) => ({ word, startMs, endMs });

  it('sin gaps grandes no sugiere nada', () => {
    const words = [w('nadie', 0, 300), w('me', 350, 500), w('ama', 550, 900)];
    expect(suggestLineBreaks(words)).toEqual([]);
  });

  it('gap mayor al umbral sugiere division tras esa palabra', () => {
    const words = [w('nadie', 0, 300), w('me', 350, 500), w('ama', 1200, 1500), w('hoy', 1550, 1800)];
    expect(suggestLineBreaks(words)).toEqual([1]);
  });

  it('no sugiere division que deje un lado con menos de 2 palabras', () => {
    const words = [w('si', 0, 200), w('vienes', 900, 1300), w('a', 1350, 1400), w('mi', 1450, 1600)];
    // gap tras indice 0 pero dejaria 1 sola palabra a la izquierda
    expect(suggestLineBreaks(words)).toEqual([]);
  });
});
