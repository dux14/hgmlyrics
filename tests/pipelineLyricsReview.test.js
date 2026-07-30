import { describe, it, expect, vi } from 'vitest';
import {
  buildReviewDoc,
  applyReviewAction,
  canApprove,
  approvedSnapshot,
} from '../api/_lib/pipeline/lyricsReview.js';
import * as seedLyrics from '../api/_lib/pipeline/seedLyrics.js';

// Transcripción mínima: transLines en orden temporal, words planas
// concatenadas en el mismo orden (shape real de align_app.py run_transcribe).
function trans(lines) {
  // lines: [{text, words:[[startMs,endMs,score], ...]}]
  const transLines = lines.map((l) => l.text);
  const words = lines.flatMap((l, i) =>
    (l.words ?? []).map(([startMs, endMs, score], k) => ({
      word: transLines[i].split(/\s+/)[k] ?? `w${k}`,
      startMs,
      endMs,
      score,
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
        {
          text: 'hola mundo',
          words: [
            [500, 900, 0.9],
            [1000, 1500, 0.8],
          ],
        },
        {
          text: 'canto fuerte',
          words: [
            [11000, 11500, 0.9],
            [11600, 12000, 0.7],
          ],
        },
      ]),
      structureSegments: SEGS,
    });
    expect(doc.version).toBe(2);
    // instrumental SÍ genera sección (contenido válido de la canción), con
    // lines: [] porque no hay renglones cantados en ese tramo.
    expect(doc.sections.map((s) => s.type)).toEqual(['verse', 'chorus', 'instrumental']);
    expect(doc.sections[0].lines.map((l) => l.text)).toEqual(['hola mundo']);
    expect(doc.sections[1].lines.map((l) => l.text)).toEqual(['canto fuerte']);
    expect(doc.sections[2].lines).toEqual([]);
    // H1 parte 2: el envelope de la sección ahora se recalcula desde sus
    // renglones reales, no queda en el límite declarado por SongFormer (0).
    expect(doc.sections[0].startMs).toBe(500);
    expect(doc.sections[0].lines[0]).toMatchObject({
      startMs: 500,
      endMs: 1500,
      vocalization: false,
      breath: false,
      manualStartMs: null,
    });
  });

  it('el instrumental conserva su envelope real del segmento con lines: []', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        { text: 'hola mundo', words: [[500, 900, 0.9]] },
        { text: 'canto fuerte', words: [[21000, 21500, 0.9]] },
      ]),
      structureSegments: [
        { label: 'verso', startMs: 0, endMs: 10000 },
        { label: 'instrumental', startMs: 10000, endMs: 20000 },
        { label: 'verso', startMs: 20000, endMs: 30000 },
      ],
    });
    expect(doc.sections).toHaveLength(3);
    const instrumental = doc.sections[1];
    expect(instrumental.type).toBe('instrumental');
    expect(instrumental.lines).toEqual([]);
    expect(instrumental.startMs).toBe(10000);
    expect(instrumental.endMs).toBe(20000);
  });

  it('dos segmentos instrumental adyacentes fusionan en una sola sección', () => {
    const doc = buildReviewDoc({
      transcription: trans([{ text: 'hola mundo', words: [[500, 900, 0.9]] }]),
      structureSegments: [
        { label: 'verso', startMs: 0, endMs: 10000 },
        { label: 'instrumental', startMs: 10000, endMs: 15000 },
        { label: 'instrumental', startMs: 15000, endMs: 20000 },
      ],
    });
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[1]).toMatchObject({
      type: 'instrumental',
      startMs: 10000,
      endMs: 20000,
      lines: [],
    });
  });

  it('colapsa la sobre-segmentación antes de armar las secciones', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        {
          text: 'canto uno',
          words: [
            [11000, 11500, 0.9],
            [11600, 12000, 0.9],
          ],
        },
        {
          text: 'canto dos',
          words: [
            [25000, 25500, 0.9],
            [25600, 26000, 0.9],
          ],
        },
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
      transcription: trans([
        {
          text: 'una dos tres',
          words: [
            [0, 100, 0.9],
            [110, 200, null],
            [210, 300, 0.6],
          ],
        },
      ]),
      structureSegments: [SEGS[0]],
    });
    expect(doc.sections[0].lines[0].confidence).toBe(0.75);
  });

  it('renglón que cruza dos segmentos va al de MAYOR solape', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        {
          text: 'cruza aqui',
          words: [
            [9000, 9600, 0.9],
            [9700, 15000, 0.9],
          ],
        },
      ]),
      structureSegments: SEGS,
    });
    // solape verso = 1000ms, coro = 5000ms -> coro
    expect(doc.sections[1].lines).toHaveLength(1);
    expect(doc.sections[0].lines).toHaveLength(0); // segmento sin renglones queda vacío
  });

  it('renglón que solo solapa instrumental cae en la sección lírica más cercana', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        {
          text: 'ad lib',
          words: [
            [21000, 21500, 0.9],
            [21600, 22000, 0.9],
          ],
        },
      ]),
      structureSegments: SEGS,
    });
    expect(doc.sections[1].lines.map((l) => l.text)).toEqual(['ad lib']); // coro (endMs 20000) es la más cercana
  });

  it('renglón sin words hereda la sección del renglón anterior, con timing null y vocalization', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        {
          text: 'con timing',
          words: [
            [11000, 11900, 0.9],
            [12000, 12400, 0.9],
          ],
        },
        { text: 'sin timing', words: [] },
      ]),
      structureSegments: SEGS,
    });
    const [a, b] = doc.sections[1].lines;
    expect(a.text).toBe('con timing');
    expect(b).toMatchObject({
      text: 'sin timing',
      startMs: null,
      endMs: null,
      confidence: null,
      vocalization: true,
    });
  });

  it('confidence < 0.4 marca vocalization automática', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        {
          text: 'mmm ahh',
          words: [
            [0, 400, 0.2],
            [500, 900, 0.3],
          ],
        },
      ]),
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
    const longText =
      'esta es una linea larguisima que definitivamente supera los cuarenta y ocho caracteres';
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
            [31660, 32000, 0.9],
            [32100, 32400, 0.9],
            [32500, 32700, 0.9],
            [32800, 33100, 0.9],
            [33200, 33800, 0.9],
            [34000, 34300, 0.9],
            [34400, 34700, 0.9],
            [34800, 35400, 0.9],
            [39000, 39300, 0.9],
            [39400, 39700, 0.9],
            [39800, 40000, 0.9],
            [40100, 40300, 0.9],
            [40400, 41000, 0.9],
            [42500, 42900, 0.9],
            [43000, 43600, 0.9],
            [43700, 43900, 0.9],
            [44000, 44400, 0.9],
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
    const bounds = [
      [28200, 42100],
      [42100, 58200],
    ];
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

describe('buildReviewDoc v2 + semilla: aislamiento del match entre fragmentos de frontera (blocker tanda C)', () => {
  it('el fragmento posterior a una frontera de sección no reusa el match del anterior (sin corte espurio)', () => {
    const doc = buildReviewDoc({
      transcription: {
        text: 'sé que tú me cuidarás quiero escuchar tu voz',
        transLines: ['sé que tú me cuidarás quiero escuchar tu voz'],
        words: [
          { word: 'sé', startMs: 39000, endMs: 39300, score: 0.9 },
          { word: 'que', startMs: 39400, endMs: 39700, score: 0.9 },
          { word: 'tú', startMs: 39800, endMs: 40000, score: 0.9 },
          { word: 'me', startMs: 40100, endMs: 40300, score: 0.9 },
          { word: 'cuidarás', startMs: 40400, endMs: 41000, score: 0.9 },
          { word: 'quiero', startMs: 42500, endMs: 42900, score: 0.9 },
          { word: 'escuchar', startMs: 43000, endMs: 43600, score: 0.9 },
          { word: 'tu', startMs: 43700, endMs: 43900, score: 0.9 },
          { word: 'voz', startMs: 44000, endMs: 44400, score: 0.9 },
        ],
        // Alinea el renglón completo contra dbIndex 0 ("sé que"): el mismo
        // match que antes se reusaba, sin corregir, en el segundo fragmento.
        perLine: [{ transIndex: 0, dbIndex: 0, score: 0.9 }],
      },
      structureSegments: [
        { label: 'coro', startMs: 28200, endMs: 42100 },
        { label: 'verso', startMs: 42100, endMs: 58200 },
      ],
      seedSections: [
        {
          type: 'verse',
          lines: [
            { text: 'sé que' },
            { text: 'tú me cuidarás' },
            { text: 'quiero escuchar tu voz' },
          ],
        },
      ],
    });
    const allLines = doc.sections.flatMap((s) => s.lines.map((l) => l.text));
    // Con el bug, "quiero escuchar tu voz" quedaba partido en "quiero
    // escuchar" / "tu voz" al heredar el dbIndex del primer fragmento.
    expect(allLines).toContain('quiero escuchar tu voz');
  });

  it('un renglón que cruza dos líneas de semilla de secciones distintas no funde el chorus dentro del verse', () => {
    const doc = buildReviewDoc({
      transcription: {
        text: 'me cuidarás quiero escuchar',
        transLines: ['me cuidarás quiero escuchar'],
        words: [
          { word: 'me', startMs: 8000, endMs: 8400, score: 0.9 },
          { word: 'cuidarás', startMs: 8500, endMs: 9200, score: 0.9 },
          { word: 'quiero', startMs: 10500, endMs: 10900, score: 0.9 },
          { word: 'escuchar', startMs: 11000, endMs: 11600, score: 0.9 },
        ],
        // dbIndex 1 = "me cuidarás", última línea del verse en la semilla.
        perLine: [{ transIndex: 0, dbIndex: 1, score: 0.9 }],
      },
      structureSegments: [
        { label: 'verso', startMs: 0, endMs: 10000 },
        { label: 'coro', startMs: 10000, endMs: 20000 },
      ],
      seedSections: [
        { type: 'verse', lines: [{ text: 'sé que tú' }, { text: 'me cuidarás' }] },
        { type: 'chorus', lines: [{ text: 'quiero escuchar' }] },
      ],
    });
    // Con el bug, "quiero escuchar" heredaba el sectionIdx de "me cuidarás"
    // (verse) y collapseBySeed fusionaba el chorus dentro del verse,
    // perdiendo su type.
    expect(doc.sections.map((s) => s.type)).toContain('chorus');
    expect(doc.sections).toHaveLength(2);
  });
});

describe('buildReviewDoc v2: sin semilla no corre monotonicAlign (nice-to-have)', () => {
  it('seedSections vacío/ausente evita monotonicAlign (su resultado nunca se consulta)', () => {
    const spy = vi.spyOn(seedLyrics, 'monotonicAlign');
    buildReviewDoc({
      transcription: trans([
        {
          text: 'hola mundo',
          words: [
            [0, 500, 0.9],
            [600, 900, 0.8],
          ],
        },
      ]),
      structureSegments: [],
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('con semilla sí corre monotonicAlign', () => {
    const spy = vi.spyOn(seedLyrics, 'monotonicAlign');
    buildReviewDoc({
      transcription: trans([
        {
          text: 'hola mundo',
          words: [
            [0, 500, 0.9],
            [600, 900, 0.8],
          ],
        },
      ]),
      structureSegments: [],
      seedSections: [{ lines: [{ text: 'hola mundo' }] }],
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
    expect(
      canApprove({
        version: 2,
        sections: [{ type: 'verse', label: null, startMs: 0, endMs: 1, lines: [] }],
      }),
    ).toBe(false);
  });
});

describe('approvedSnapshot v2', () => {
  it('devuelve las sections tal cual + hash sha256 determinístico', () => {
    const doc = buildReviewDoc({
      transcription: trans([
        {
          text: 'uno dos',
          words: [
            [0, 500, 0.9],
            [600, 900, 0.8],
          ],
        },
      ]),
      structureSegments: [],
    });
    const a = approvedSnapshot(doc);
    const b = approvedSnapshot(structuredClone(doc));
    expect(a.sections).toEqual(doc.sections);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);
  });

  // Nice-to-have review tanda C: seedSectionIdx es interno de buildReviewDoc
  // (solo tiene sentido mientras se arma el doc), no debe llegar al store
  // persistido de song_pipeline_lyrics.
  it('excluye seedSectionIdx (interno) del snapshot persistido', () => {
    const doc = buildReviewDoc({
      transcription: {
        text: 'uno',
        transLines: ['uno'],
        words: [{ word: 'uno', startMs: 0, endMs: 500, score: 0.9 }],
        perLine: [{ transIndex: 0, dbIndex: 0, score: 0.9 }],
      },
      structureSegments: [],
      seedSections: [{ lines: [{ text: 'uno' }] }],
    });
    // Sanity: si esto no está seteado, el test no ejercita nada.
    expect(doc.sections[0].lines[0].seedSectionIdx).toBe(0);

    const snap = approvedSnapshot(doc);
    for (const section of snap.sections) {
      for (const line of section.lines) {
        expect(line).not.toHaveProperty('seedSectionIdx');
      }
    }
  });
});

describe('applyReviewAction v2', () => {
  const base = () =>
    buildReviewDoc({
      transcription: trans([
        {
          text: 'uno dos',
          words: [
            [0, 400, 0.9],
            [500, 900, 0.9],
          ],
        },
        {
          text: 'tres cuatro',
          words: [
            [1000, 1400, 0.9],
            [1500, 1900, 0.9],
          ],
        },
        {
          text: 'coro grande',
          words: [
            [11000, 11400, 0.9],
            [11500, 11900, 0.9],
          ],
        },
      ]),
      structureSegments: SEGS,
    });

  it('editLine cambia el texto sin mutar el doc original', () => {
    const doc = base();
    const next = applyReviewAction(doc, {
      type: 'editLine',
      section: 0,
      line: 0,
      text: 'uno dos editado',
    });
    expect(next.sections[0].lines[0].text).toBe('uno dos editado');
    expect(doc.sections[0].lines[0].text).toBe('uno dos');
  });

  it('editLine con texto vacío lanza RangeError', () => {
    expect(() =>
      applyReviewAction(base(), { type: 'editLine', section: 0, line: 0, text: '  ' }),
    ).toThrow(RangeError);
  });

  it('editLine descarta words si cambió la cantidad de tokens (#6: pipelineLinesFor no debe heredar endMs viejo)', () => {
    const doc = base();
    expect(doc.sections[0].lines[0].words).toHaveLength(2); // 'uno dos'
    const next = applyReviewAction(doc, { type: 'editLine', section: 0, line: 0, text: 'uno' });
    expect(next.sections[0].lines[0].text).toBe('uno');
    expect(next.sections[0].lines[0].words).toEqual([]);
  });

  it('editLine conserva words si la cantidad de tokens no cambió', () => {
    const doc = base();
    const next = applyReviewAction(doc, { type: 'editLine', section: 0, line: 0, text: 'una dos' });
    expect(next.sections[0].lines[0].words).toHaveLength(2);
  });

  it('splitLine parte texto y words', () => {
    const next = applyReviewAction(base(), {
      type: 'splitLine',
      section: 0,
      line: 0,
      afterWord: 0,
    });
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
      type: 'moveLine',
      fromSection: 0,
      fromLine: 1,
      toSection: 1,
      toLine: 0,
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
    const next = applyReviewAction(doc, {
      type: 'moveLine',
      fromSection: 0,
      fromLine: 0,
      toSection: 0,
      toLine: 1,
    });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['b', 'a']);
  });

  it('deleteLine elimina el renglón', () => {
    const next = applyReviewAction(base(), { type: 'deleteLine', section: 0, line: 0 });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['tres cuatro']);
  });

  it('setSectionType normaliza y retipa; renameSection fija label (null lo limpia)', () => {
    let next = applyReviewAction(base(), {
      type: 'setSectionType',
      section: 0,
      sectionType: 'estribillo',
    });
    expect(next.sections[0].type).toBe('chorus');
    next = applyReviewAction(next, { type: 'renameSection', section: 0, label: 'Coro final' });
    expect(next.sections[0].label).toBe('Coro final');
    next = applyReviewAction(next, { type: 'renameSection', section: 0, label: null });
    expect(next.sections[0].label).toBeNull();
  });

  it('setSectionType conserva instrumental como tipo conocido', () => {
    const next = applyReviewAction(base(), {
      type: 'setSectionType',
      section: 0,
      sectionType: 'instrumental',
    });
    expect(next.sections[0].type).toBe('instrumental');
  });

  it('setBreath y toggleVocalization', () => {
    let next = applyReviewAction(base(), { type: 'setBreath', section: 0, line: 0, breath: true });
    expect(next.sections[0].lines[0].breath).toBe(true);
    next = applyReviewAction(next, { type: 'toggleVocalization', section: 0, line: 0 });
    expect(next.sections[0].lines[0].vocalization).toBe(true);
  });

  it('setLineStart fija manualStartMs y null lo limpia', () => {
    let next = applyReviewAction(base(), {
      type: 'setLineStart',
      section: 0,
      line: 0,
      startMs: 250,
    });
    expect(next.sections[0].lines[0].manualStartMs).toBe(250);
    next = applyReviewAction(next, { type: 'setLineStart', section: 0, line: 0, startMs: null });
    expect(next.sections[0].lines[0].manualStartMs).toBeNull();
  });

  it('índices inválidos y acciones desconocidas lanzan RangeError', () => {
    expect(() => applyReviewAction(base(), { type: 'deleteLine', section: 9, line: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      applyReviewAction(base(), {
        type: 'moveLine',
        fromSection: 0,
        fromLine: 0,
        toSection: 9,
        toLine: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      applyReviewAction(base(), { type: 'resolve', section: 0, line: 0, choice: 'db' }),
    ).toThrow(RangeError);
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

  // Important de seguridad (review tanda C): doc.sections['__proto__'] es
  // Array.prototype (truthy) sin el guard de Number.isInteger, así que el
  // `if (!section)` no dispara y la acción sigue mutando el prototipo
  // global — en serverless con instancias tibias, eso contamina TODAS las
  // requests siguientes hasta el próximo cold start.
  it('índice "__proto__" lanza RangeError y no contamina Array.prototype', () => {
    expect(() =>
      applyReviewAction(base(), { type: 'renameSection', section: '__proto__', label: 'PWNED' }),
    ).toThrow(RangeError);
    expect(Array.prototype.label).toBeUndefined();

    expect(() =>
      applyReviewAction(base(), {
        type: 'setBreath',
        section: 0,
        line: '__proto__',
        breath: true,
      }),
    ).toThrow(RangeError);
    expect(Array.prototype.breath).toBeUndefined();
  });

  it('índice no entero (float, string numérica) lanza RangeError', () => {
    expect(() => applyReviewAction(base(), { type: 'deleteLine', section: 0, line: 0.5 })).toThrow(
      RangeError,
    );
    expect(() => applyReviewAction(base(), { type: 'deleteLine', section: '0', line: 0 })).toThrow(
      RangeError,
    );
  });

  it('setLineText sin \\n cambia solo el texto (equivale a editLine)', () => {
    const next = applyReviewAction(base(), {
      type: 'setLineText',
      section: 0,
      line: 0,
      text: 'uno dos editado',
    });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['uno dos editado', 'tres cuatro']);
    expect(next.sections[0].lines[0].startMs).toBe(0); // conserva timing, como editLine
  });

  it('setLineText sin \\n descarta words si cambió la cantidad de tokens (#6)', () => {
    const doc = base();
    expect(doc.sections[0].lines[0].words).toHaveLength(2); // 'uno dos'
    const next = applyReviewAction(doc, { type: 'setLineText', section: 0, line: 0, text: 'uno' });
    expect(next.sections[0].lines[0].text).toBe('uno');
    expect(next.sections[0].lines[0].words).toEqual([]);
  });

  it('setLineText con \\n parte el renglón en piezas (splice conserva el resto)', () => {
    const next = applyReviewAction(base(), {
      type: 'setLineText',
      section: 0,
      line: 0,
      text: 'uno\ndos',
    });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['uno', 'dos', 'tres cuatro']);
  });

  it('setLineText con texto vacío lanza RangeError, igual criterio que editLine', () => {
    expect(() =>
      applyReviewAction(base(), { type: 'setLineText', section: 0, line: 0, text: '  ' }),
    ).toThrow(RangeError);
  });

  it('setLineText con índice inválido lanza RangeError y no muta el doc', () => {
    const doc = base();
    expect(() =>
      applyReviewAction(doc, { type: 'setLineText', section: 0, line: 9, text: 'x' }),
    ).toThrow(RangeError);
    expect(doc.sections[0].lines.map((l) => l.text)).toEqual(['uno dos', 'tres cuatro']);
  });

  it('setLanguage escribe doc.language sin mutar el original; valor fuera de es/en lanza RangeError', () => {
    const doc = base();
    expect(doc.language).toBe('es');
    const next = applyReviewAction(doc, { type: 'setLanguage', language: 'en' });
    expect(next.language).toBe('en');
    expect(doc.language).toBe('es');
    expect(() => applyReviewAction(doc, { type: 'setLanguage', language: 'fr' })).toThrow(
      RangeError,
    );
  });

  it('approvedSnapshot no cambia con el idioma: el hash solo depende de sections', () => {
    const doc = base();
    const withEn = applyReviewAction(doc, { type: 'setLanguage', language: 'en' });
    expect(approvedSnapshot(doc).hash).toBe(approvedSnapshot(withEn).hash);
  });
});

// Renglón con word-timing real, shape del doc v2.
function ln(text, startMs, endMs, extra = {}) {
  return {
    text,
    startMs,
    endMs,
    words: [{ word: text.split(/\s+/)[0], startMs, endMs, score: 1 }],
    confidence: 1,
    vocalization: false,
    breath: false,
    manualStartMs: null,
    ...extra,
  };
}
function sec(type, label, startMs, endMs, lines) {
  return { type, label, startMs, endMs, lines };
}

describe('insertLine', () => {
  it('inserta un renglón vacío sin words en la posición pedida', () => {
    const doc = { version: 2, sections: [sec('verse', null, 0, 9, [ln('uno', 0, 9)])] };
    const next = applyReviewAction(doc, { type: 'insertLine', section: 0, at: 1 });
    expect(next.sections[0].lines).toHaveLength(2);
    expect(next.sections[0].lines[1]).toMatchObject({
      text: '',
      startMs: null,
      endMs: null,
      words: [],
      confidence: null,
      vocalization: false,
    });
    expect(doc.sections[0].lines).toHaveLength(1); // no muta
  });

  it('at fuera de rango lanza RangeError', () => {
    const doc = { version: 2, sections: [sec('verse', null, 0, 0, [])] };
    expect(() => applyReviewAction(doc, { type: 'insertLine', section: 0, at: 2 })).toThrow(
      RangeError,
    );
  });
});

describe('duplicateLine', () => {
  it('copia texto y vocalización, nunca los tiempos', () => {
    const doc = {
      version: 2,
      sections: [
        sec('chorus', null, 0, 9, [
          ln('coro', 3, 9, { vocalization: true, breath: true, manualStartMs: 5 }),
        ]),
      ],
    };
    const next = applyReviewAction(doc, { type: 'duplicateLine', section: 0, line: 0 });
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['coro', 'coro']);
    expect(next.sections[0].lines[1]).toMatchObject({
      startMs: null,
      endMs: null,
      words: [],
      confidence: null,
      vocalization: true,
      manualStartMs: null,
    });
  });
});

describe('acciones de sección', () => {
  const base = () => ({
    version: 2,
    sections: [
      sec('verse', null, 0, 10, [ln('uno', 0, 10)]),
      sec('chorus', 'Estribillo', 10, 20, [ln('dos', 10, 20)]),
    ],
  });

  it('insertSection agrega una sección vacía con envelope colapsado', () => {
    const next = applyReviewAction(base(), { type: 'insertSection', at: 2 });
    expect(next.sections).toHaveLength(3);
    expect(next.sections[2]).toMatchObject({
      type: 'verse',
      label: null,
      startMs: 20,
      endMs: 20,
      lines: [],
    });
  });

  it('insertSection acepta sectionType instrumental', () => {
    const next = applyReviewAction(base(), {
      type: 'insertSection',
      at: 2,
      sectionType: 'instrumental',
    });
    expect(next.sections[2].type).toBe('instrumental');
  });

  it('duplicateSection copia tipo, nombre y textos, sin tiempos', () => {
    const next = applyReviewAction(base(), { type: 'duplicateSection', section: 1 });
    expect(next.sections.map((s) => s.type)).toEqual(['verse', 'chorus', 'chorus']);
    expect(next.sections[2].label).toBe('Estribillo');
    expect(next.sections[2].lines[0]).toMatchObject({
      text: 'dos',
      words: [],
      startMs: null,
      confidence: null,
    });
  });

  it('deleteSection reubica sus renglones en la anterior', () => {
    const next = applyReviewAction(base(), { type: 'deleteSection', section: 1 });
    expect(next.sections).toHaveLength(1);
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['uno', 'dos']);
    expect(next.sections[0].endMs).toBe(20);
  });

  it('deleteSection de la primera reubica en la siguiente, al principio', () => {
    const next = applyReviewAction(base(), { type: 'deleteSection', section: 0 });
    expect(next.sections).toHaveLength(1);
    expect(next.sections[0].lines.map((l) => l.text)).toEqual(['uno', 'dos']);
  });

  it('deleteSection de la única sección lanza RangeError', () => {
    const doc = {
      version: 2,
      sections: [{ type: 'verse', label: null, startMs: 0, endMs: 1, lines: [] }],
    };
    expect(() => applyReviewAction(doc, { type: 'deleteSection', section: 0 })).toThrow(RangeError);
  });
});
