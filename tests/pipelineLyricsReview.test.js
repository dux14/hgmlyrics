import { describe, it, expect } from 'vitest';
import {
  buildReviewDoc,
  applyReviewAction,
  canApprove,
  approvedSnapshot,
} from '../api/_lib/pipeline/lyricsReview.js';

// Transcripción mínima: transLines en orden temporal, words planas
// concatenadas en el mismo orden (shape real de align_app.py run_transcribe).
function trans(lines) {
  // lines: [{text, words:[[startMs,endMs,score], ...]}]
  const transLines = lines.map((l) => l.text);
  const words = lines.flatMap((l, i) =>
    (l.words ?? []).map(([startMs, endMs, score], k) => ({
      word: transLines[i].split(/\s+/)[k] ?? `w${k}`, startMs, endMs, score,
    })),
  );
  return { text: transLines.join('\n'), transLines, words, perLine: [] };
}

const SEGS = [
  { label: 'verso', startMs: 0, endMs: 10000 },
  { label: 'coro', startMs: 10000, endMs: 20000 },
  { label: 'instrumental', startMs: 20000, endMs: 30000 },
];

describe('buildReviewDoc v2', () => {
  it('espina = segmentos mapeables; renglones asignados por mayor solape', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        { text: 'hola mundo', words: [[500, 900, 0.9], [1000, 1500, 0.8]] },
        { text: 'canto fuerte', words: [[11000, 11500, 0.9], [11600, 12000, 0.7]] },
      ]),
      structureSegments: SEGS,
    });
    expect(doc.version).toBe(2);
    expect(doc.sections.map((s) => s.type)).toEqual(['verse', 'chorus']); // instrumental NO genera sección
    expect(doc.sections[0].lines.map((l) => l.text)).toEqual(['hola mundo']);
    expect(doc.sections[1].lines.map((l) => l.text)).toEqual(['canto fuerte']);
    // H1 parte 2: el envelope de la sección ahora se recalcula desde sus
    // renglones reales, no queda en el límite declarado por SongFormer (0).
    expect(doc.sections[0].startMs).toBe(500);
    expect(doc.sections[0].lines[0]).toMatchObject({
      startMs: 500, endMs: 1500, vocalization: false, breath: false, manualStartMs: null,
    });
  });

  it('colapsa la sobre-segmentación antes de armar las secciones', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        { text: 'canto uno', words: [[11000, 11500, 0.9], [11600, 12000, 0.9]] },
        { text: 'canto dos', words: [[25000, 25500, 0.9], [25600, 26000, 0.9]] },
      ]),
      structureSegments: [
        { label: 'coro', startMs: 10000, endMs: 24000 },
        { label: 'coro', startMs: 24000, endMs: 38000 },
      ],
    });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].lines.map((l) => l.text)).toEqual(['canto uno', 'canto dos']);
  });

  it('confidence = promedio del score por palabra (round4), ignorando scores null', () => {
    const doc = buildReviewDoc({
      transcription: trans([{ text: 'una dos tres', words: [[0, 100, 0.9], [110, 200, null], [210, 300, 0.6]] }]),
      structureSegments: [SEGS[0]],
    });
    expect(doc.sections[0].lines[0].confidence).toBe(0.75);
  });

  it('renglón que cruza dos segmentos va al de MAYOR solape', () => {
    const doc = buildReviewDoc({
      transcription: trans([{ text: 'cruza aqui', words: [[9000, 9600, 0.9], [9700, 15000, 0.9]] }]),
      structureSegments: SEGS,
    });
    // solape verso = 1000ms, coro = 5000ms -> coro
    expect(doc.sections[1].lines).toHaveLength(1);
    expect(doc.sections[0].lines).toHaveLength(0); // segmento sin renglones queda vacío
  });

  it('renglón que solo solapa instrumental cae en la sección lírica más cercana', () => {
    const doc = buildReviewDoc({
      transcription: trans([{ text: 'ad lib', words: [[21000, 21500, 0.9], [21600, 22000, 0.9]] }]),
      structureSegments: SEGS,
    });
    expect(doc.sections[1].lines.map((l) => l.text)).toEqual(['ad lib']); // coro (endMs 20000) es la más cercana
  });

  it('renglón sin words hereda la sección del renglón anterior, con timing null y vocalization', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        { text: 'con timing', words: [[11000, 11900, 0.9], [12000, 12400, 0.9]] },
        { text: 'sin timing', words: [] },
      ]),
      structureSegments: SEGS,
    });
    const [a, b] = doc.sections[1].lines;
    expect(a.text).toBe('con timing');
    expect(b).toMatchObject({ text: 'sin timing', startMs: null, endMs: null, confidence: null, vocalization: true });
  });

  it('confidence < 0.4 marca vocalization automática', () => {
    const doc = buildReviewDoc({
      transcription: trans([{ text: 'mmm ahh', words: [[0, 400, 0.2], [500, 900, 0.3]] }]),
      structureSegments: [SEGS[0]],
    });
    expect(doc.sections[0].lines[0].vocalization).toBe(true);
  });

  it('fallback sin SongFormer: una sola sección verse con todos los renglones', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        { text: 'uno', words: [[0, 500, 0.9]] },
        { text: 'dos', words: [[600, 1100, 0.9]] },
      ]),
      structureSegments: [],
    });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]).toMatchObject({ type: 'verse', label: null, startMs: 0, endMs: 1100 });
    expect(doc.sections[0].lines).toHaveLength(2);
  });

  it('auto-parte renglones > 48 chars repartiendo las words con el corte', () => {
    const longText = 'esta es una linea larguisima que definitivamente supera los cuarenta y ocho caracteres';
    const tokens = longText.split(' ');
    const words = tokens.map((_, i) => [i * 500, i * 500 + 400, 0.9]);
    const doc = buildReviewDoc({
      transcription: trans([{ text: longText, words }]),
      structureSegments: [{ label: 'verso', startMs: 0, endMs: 60000 }],
    });
    const lines = doc.sections[0].lines;
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(l.text.length).toBeLessThanOrEqual(48);
      expect(l.startMs).toBe(l.words[0].startMs); // words repartidas, no duplicadas
    }
    expect(lines.flatMap((l) => l.words)).toHaveLength(tokens.length);
  });

  it('los pedazos de un segmento largo caen cada uno en su sección (H1)', () => {
    // Segmento único 31.7→44.4 s que solapa más con la sección 2 pero cuyas
    // primeras palabras caen enteras dentro de la 1.
    const doc = buildReviewDoc({
      transcription: trans([
        {
          text: 'el cielo y lo demás está de más sé que tú me cuidarás quiero escuchar tu voz',
          words: [
            [31660, 32000, 0.9], [32100, 32400, 0.9], [32500, 32700, 0.9],
            [32800, 33100, 0.9], [33200, 33800, 0.9], [34000, 34300, 0.9],
            [34400, 34700, 0.9], [34800, 35400, 0.9], [39000, 39300, 0.9],
            [39400, 39700, 0.9], [39800, 40000, 0.9], [40100, 40300, 0.9],
            [40400, 41000, 0.9], [42500, 42900, 0.9], [43000, 43600, 0.9],
            [43700, 43900, 0.9], [44000, 44400, 0.9],
          ],
        },
      ]),
      structureSegments: [
        { label: 'coro', startMs: 28200, endMs: 42100 },
        { label: 'verso', startMs: 42100, endMs: 58200 },
      ],
    });
    // Ninguna sección con canto queda vacía.
    expect(doc.sections[0].lines.length).toBeGreaterThan(0);
    expect(doc.sections[1].lines.length).toBeGreaterThan(0);
    // Ningún renglón mezcla palabras de las dos secciones: cota inferior Y
    // superior por sección (solo la inferior no detecta un renglón que cruzó
    // a la sección siguiente).
    const bounds = [[28200, 42100], [42100, 58200]];
    for (const [i, section] of doc.sections.entries()) {
      const [lo, hi] = bounds[i];
      for (const l of section.lines) {
        expect(l.startMs).toBeGreaterThanOrEqual(lo);
        expect(l.startMs).toBeLessThan(hi);
      }
    }
    // El envelope de cada sección refleja sus renglones reales.
    expect(doc.sections[0].endMs).toBeLessThanOrEqual(42100);
  });

  it('auto-split re-deriva vocalization por mitad según el confidence de cada una', () => {
    const tokens = ['alfa', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota'];
    const text = tokens.join(' '); // > 48 chars -> se auto-parte
    const words = tokens.map((_, i) => [i * 500, i * 500 + 400, i < 5 ? 0.9 : 0.1]);
    const doc = buildReviewDoc({
      transcription: trans([{ text, words }]),
      structureSegments: [{ label: 'verso', startMs: 0, endMs: 60000 }],
    });
    const lines = doc.sections[0].lines;
    const low = lines.find((l) => l.confidence !== null && l.confidence < 0.4);
    expect(low).toBeTruthy();
    expect(low.vocalization).toBe(true);
  });

  it('sin word-timing en toda la transcripción, los renglones caen en la primera sección y quedan vocalization', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        { text: 'uno', words: [] },
        { text: 'dos', words: [] },
      ]),
      structureSegments: SEGS,
    });
    expect(doc.sections[0].lines.map((l) => l.text)).toEqual(['uno', 'dos']);
    expect(doc.sections[0].lines.every((l) => l.vocalization)).toBe(true);
  });
});

describe('canApprove v2 (editor puro)', () => {
  it('true con al menos un renglón; false con doc vacío', () => {
    const doc = buildReviewDoc({
      transcription: trans([{ text: 'uno', words: [[0, 500, 0.9]] }]),
      structureSegments: [],
    });
    expect(canApprove(doc)).toBe(true);
    expect(canApprove({ version: 2, sections: [] })).toBe(false);
    expect(canApprove({ version: 2, sections: [{ type: 'verse', label: null, startMs: 0, endMs: 1, lines: [] }] })).toBe(false);
  });
});

describe('approvedSnapshot v2', () => {
  it('devuelve las sections tal cual + hash sha256 determinístico', () => {
    const doc = buildReviewDoc({
      transcription: trans([{ text: 'uno dos', words: [[0, 500, 0.9], [600, 900, 0.8]] }]),
      structureSegments: [],
    });
    const a = approvedSnapshot(doc);
    const b = approvedSnapshot(structuredClone(doc));
    expect(a.sections).toEqual(doc.sections);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);
  });
});

describe('applyReviewAction v2', () => {
  const base = () =>
    buildReviewDoc({
      transcription: trans([
        { text: 'uno dos', words: [[0, 400, 0.9], [500, 900, 0.9]] },
        { text: 'tres cuatro', words: [[1000, 1400, 0.9], [1500, 1900, 0.9]] },
        { text: 'coro grande', words: [[11000, 11400, 0.9], [11500, 11900, 0.9]] },
      ]),
      structureSegments: SEGS,
    });

  it('editLine cambia el texto sin mutar el doc original', () => {
    const doc = base();
    const next = applyReviewAction(doc, { type: 'editLine', section: 0, line: 0, text: 'uno dos editado' });
    expect(next.sections[0].lines[0].text).toBe('uno dos editado');
    expect(doc.sections[0].lines[0].text).toBe('uno dos');
  });

  it('editLine con texto vacío lanza RangeError', () => {
    expect(() => applyReviewAction(base(), { type: 'editLine', section: 0, line: 0, text: '  ' }))
      .toThrow(RangeError);
  });

  it('splitLine parte texto y words', () => {
    const next = applyReviewAction(base(), { type: 'splitLine', section: 0, line: 0, afterWord: 0 });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['uno', 'dos', 'tres cuatro']);
    expect(next.sections[0].lines[1].startMs).toBe(500);
  });

  it('mergeLines une texto, words y recalcula timing', () => {
    const next = applyReviewAction(base(), { type: 'mergeLines', section: 0, line: 0 });
    const merged = next.sections[0].lines[0];
    expect(merged.text).toBe('uno dos tres cuatro');
    expect(merged.words).toHaveLength(4);
    expect(merged.startMs).toBe(0);
    expect(merged.endMs).toBe(1900);
  });

  it('moveLine mueve un renglón entre secciones en la posición pedida', () => {
    const next = applyReviewAction(base(), {
      type: 'moveLine', fromSection: 0, fromLine: 1, toSection: 1, toLine: 0,
    });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['uno dos']);
    expect(next.sections[1].lines.map((l) => l.text)).toEqual(['tres cuatro', 'coro grande']);
  });

  it('moveLine dentro de la misma sección reordena los renglones', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        { text: 'a', words: [[0, 100, 0.9]] },
        { text: 'b', words: [[200, 300, 0.9]] },
      ]),
      structureSegments: [SEGS[0]],
    });
    const next = applyReviewAction(doc, { type: 'moveLine', fromSection: 0, fromLine: 0, toSection: 0, toLine: 1 });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['b', 'a']);
  });

  it('deleteLine elimina el renglón', () => {
    const next = applyReviewAction(base(), { type: 'deleteLine', section: 0, line: 0 });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['tres cuatro']);
  });

  it('setSectionType normaliza y retipa; renameSection fija label (null lo limpia)', () => {
    let next = applyReviewAction(base(), { type: 'setSectionType', section: 0, sectionType: 'estribillo' });
    expect(next.sections[0].type).toBe('chorus');
    next = applyReviewAction(next, { type: 'renameSection', section: 0, label: 'Coro final' });
    expect(next.sections[0].label).toBe('Coro final');
    next = applyReviewAction(next, { type: 'renameSection', section: 0, label: null });
    expect(next.sections[0].label).toBeNull();
  });

  it('setBreath y toggleVocalization', () => {
    let next = applyReviewAction(base(), { type: 'setBreath', section: 0, line: 0, breath: true });
    expect(next.sections[0].lines[0].breath).toBe(true);
    next = applyReviewAction(next, { type: 'toggleVocalization', section: 0, line: 0 });
    expect(next.sections[0].lines[0].vocalization).toBe(true);
  });

  it('setLineStart fija manualStartMs y null lo limpia', () => {
    let next = applyReviewAction(base(), { type: 'setLineStart', section: 0, line: 0, startMs: 250 });
    expect(next.sections[0].lines[0].manualStartMs).toBe(250);
    next = applyReviewAction(next, { type: 'setLineStart', section: 0, line: 0, startMs: null });
    expect(next.sections[0].lines[0].manualStartMs).toBeNull();
  });

  it('índices inválidos y acciones desconocidas lanzan RangeError', () => {
    expect(() => applyReviewAction(base(), { type: 'deleteLine', section: 9, line: 0 })).toThrow(RangeError);
    expect(() => applyReviewAction(base(), { type: 'moveLine', fromSection: 0, fromLine: 0, toSection: 9, toLine: 0 })).toThrow(RangeError);
    expect(() => applyReviewAction(base(), { type: 'resolve', section: 0, line: 0, choice: 'db' })).toThrow(RangeError);
  });

  it('splitSection y mergeSections mantienen startMs/endMs coherentes por sección', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        { text: 'uno', words: [[0, 500, 0.9]] },
        { text: 'dos', words: [[1000, 1500, 0.9]] },
        { text: 'tres', words: [[2000, 2500, 0.9]] },
      ]),
      structureSegments: [{ label: 'verso', startMs: 0, endMs: 30000 }],
    });
    const split = applyReviewAction(doc, { type: 'splitSection', section: 0, afterLine: 0 });
    expect(split.sections).toHaveLength(2);
    for (const s of split.sections) {
      expect(typeof s.startMs).toBe('number');
      expect(typeof s.endMs).toBe('number');
    }
    expect(split.sections[0].lines.map((l) => l.text)).toEqual(['uno']);
    expect(split.sections[1].lines.map((l) => l.text)).toEqual(['dos', 'tres']);
    expect(split.sections[1].endMs).toBe(2500);
    const merged = applyReviewAction(split, { type: 'mergeSections', section: 0 });
    expect(merged.sections).toHaveLength(1);
    expect(merged.sections[0].endMs).toBe(2500);
  });
});
