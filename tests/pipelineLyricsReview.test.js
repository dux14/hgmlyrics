import { describe, expect, it } from 'vitest';
import {
  buildReviewDoc, applyReviewAction, reviewTemperature, canApprove,
  approvedSnapshot, autoSplitLongLines,
} from '../api/_lib/pipeline/lyricsReview.js';

// Fixture de scenario "con words": 14 palabras, gap de respiracion grande
// (800ms) entre "siete" (idx 6) y "ocho" (idx 7) -- el resto de los gaps son
// de 50ms (ritmo normal de habla), asi que la unica pausa candidata cae
// cerca del medio del renglon (36 de 76 caracteres antes del espacio de
// corte).
function makeWordsWithPauseAt(tokens, pauseAfterIdx, pauseMs = 800) {
  let t = 0;
  return tokens.map((text, i) => {
    const startMs = t;
    const endMs = startMs + 200;
    t = endMs + (i === pauseAfterIdx ? pauseMs : 50);
    return { text, startMs, endMs };
  });
}

const dbSections = [
  { type: 'chorus', lines: [
    { text: 'Nadie me ama como tu me amas' },
    { text: 'y en la noche oscura brillara' },
  ] },
];
const canonical = { secciones: [
  { tipo: 'chorus', lineas: [
    { texto: 'Nadie me ama como tú me amas' },
    { texto: 'y en la noche oscura brillará tu luz' },
  ] },
] };
const transcription = {
  text: 'nadie me ama como tu me amas y en la noche oscura brillara tu luz oooh oh',
  words: [], // timestamps omitidos en estos tests
  perLine: [
    { transIndex: 0, dbIndex: 0, score: 1.0 },
    { transIndex: 1, dbIndex: 1, score: 0.78 },
    { transIndex: 2, dbIndex: null, score: 0.0 }, // segmento extra (vocalizacion)
  ],
  transLines: ['nadie me ama como tu me amas', 'y en la noche oscura brillara tu luz', 'oooh oh'],
};

describe('buildReviewDoc', () => {
  it('marca conflicto donde DB y canonica difieren y adjunta las 3 fuentes', () => {
    const doc = buildReviewDoc({ dbSections, canonical, transcription });
    const line2 = doc.sections[0].lines[1];
    expect(line2.conflict).toBe(true);
    expect(line2.sources.db).toBe('y en la noche oscura brillara');
    expect(line2.sources.canonical).toBe('y en la noche oscura brillará tu luz');
  });
  it('propone vocalizaciones desde segmentos sin match', () => {
    const doc = buildReviewDoc({ dbSections, canonical, transcription });
    expect(doc.vocalizations).toHaveLength(1);
    expect(doc.vocalizations[0].text).toBe('oooh oh');
    expect(doc.vocalizations[0].accepted).toBe(null);
  });
  it('con distinta cantidad de lineas, la que no tiene match exacto queda en conflicto', () => {
    const dbSectionsExtra = [
      { type: 'chorus', lines: [
        { text: 'Nadie me ama como tu me amas' },
        { text: 'linea extra sin contraparte' },
      ] },
    ];
    const canonicalOneLine = { secciones: [
      { tipo: 'chorus', lineas: [
        { texto: 'Nadie me ama como tu me amas' },
      ] },
    ] };
    const doc = buildReviewDoc({
      dbSections: dbSectionsExtra,
      canonical: canonicalOneLine,
      transcription: { text: '', words: [], perLine: [], transLines: [] },
    });
    expect(doc.sections[0].lines[0].conflict).toBe(false); // matcheo exacto
    const extra = doc.sections[0].lines[1];
    expect(extra.conflict).toBe(true);
    expect(extra.sources.canonical).toBe(null);
  });
  it('sin canonica trabaja con 2 fuentes y lo marca', () => {
    const doc = buildReviewDoc({ dbSections, canonical: null, transcription });
    expect(doc.hasCanonical).toBe(false);
  });
  it('tolera shape real de songs.sections: coro repetido con lines null y lineas con chords/voiceRanges', () => {
    const dbSectionsReal = [
      { type: 'verse', label: 'Verso 1', lines: [
        { text: 'Nadie me ama como tu me amas', chords: [{ ch: 'D', pos: 0 }], voiceRanges: [] },
      ] },
      { type: 'chorus', label: 'Coro 1', lines: [
        { text: 'y en la noche oscura brillara', chords: [], voiceRanges: [] },
      ] },
      { type: 'chorus', label: 'Coro 2', lines: null }, // coro repetido, sin letra propia
    ];
    const build = () => buildReviewDoc({
      dbSections: dbSectionsReal,
      canonical: null,
      transcription: { text: '', words: [], perLine: [], transLines: [] },
    });
    expect(build).not.toThrow();
    const doc = build();
    expect(doc.sections[2].lines).toEqual([]); // 0 lineas editables, no null
    expect(doc.sections[0].lines[0].chords).toEqual([{ ch: 'D', pos: 0 }]);
    expect(doc.sections[0].lines[0].voiceRanges).toEqual([]);

    const snap = approvedSnapshot(doc);
    expect(snap.sections[2].lines).toBe(null); // round-trip: sigue siendo coro repetido
    expect(snap.sections[0].lines[0].chords).toEqual([{ ch: 'D', pos: 0 }]);
    expect(snap.sections[0].lines[0].voiceRanges).toEqual([]);
  });
});

describe('applyReviewAction', () => {
  const doc = () => buildReviewDoc({ dbSections, canonical, transcription });
  it('resolve con canonical fija el texto y quita el conflicto', () => {
    const d = applyReviewAction(doc(), { type: 'resolve', section: 0, line: 1, choice: 'canonical' });
    expect(d.sections[0].lines[1].conflict).toBe(false);
    expect(d.sections[0].lines[1].text).toBe('y en la noche oscura brillará tu luz');
  });
  it('splitLine divide el renglon en el indice de palabra dado', () => {
    const d = applyReviewAction(doc(), { type: 'splitLine', section: 0, line: 0, afterWord: 4 });
    expect(d.sections[0].lines[0].text).toBe('Nadie me ama como tu');
    expect(d.sections[0].lines[1].text).toBe('me amas');
  });
  it('mergeLines une dos renglones contiguos', () => {
    const split = applyReviewAction(doc(), { type: 'splitLine', section: 0, line: 0, afterWord: 4 });
    const merged = applyReviewAction(split, { type: 'mergeLines', section: 0, line: 0 });
    expect(merged.sections[0].lines[0].text).toBe('Nadie me ama como tu me amas');
  });
  it('splitLine reparte los chords por posicion y reajusta los del segundo renglon', () => {
    const dbSectionsChords = [
      { type: 'chorus', lines: [
        { text: 'Nadie me ama como tu me amas', chords: [{ ch: 'D', pos: 2 }, { ch: 'G', pos: 24 }] },
      ] },
    ];
    const withChords = buildReviewDoc({
      dbSections: dbSectionsChords,
      canonical: null,
      transcription: { text: '', words: [], perLine: [], transLines: [] },
    });
    // afterWord:4 -> primer renglon "Nadie me ama como tu" (20 caracteres),
    // cutOffset = 21. pos:2 cae antes del corte, pos:24 cae despues.
    const d = applyReviewAction(withChords, { type: 'splitLine', section: 0, line: 0, afterWord: 4 });
    expect(d.sections[0].lines[0].chords).toEqual([{ ch: 'D', pos: 2 }]);
    expect(d.sections[0].lines[1].chords).toEqual([{ ch: 'G', pos: 3 }]); // 24 - 21
  });
  it('mergeLines fusiona los chords de ambos renglones reajustando los del segundo', () => {
    const dbSectionsChords = [
      { type: 'chorus', lines: [
        { text: 'Nadie me ama como tu', chords: [{ ch: 'D', pos: 2 }] },
        { text: 'me amas', chords: [{ ch: 'G', pos: 3 }] },
      ] },
    ];
    const withChords = buildReviewDoc({
      dbSections: dbSectionsChords,
      canonical: null,
      transcription: { text: '', words: [], perLine: [], transLines: [] },
    });
    // offset = largo del primer texto (20) + separador (1) = 21.
    const d = applyReviewAction(withChords, { type: 'mergeLines', section: 0, line: 0 });
    expect(d.sections[0].lines[0].text).toBe('Nadie me ama como tu me amas');
    expect(d.sections[0].lines[0].chords).toEqual([{ ch: 'D', pos: 2 }, { ch: 'G', pos: 24 }]);
  });
  it('mergeLines fusiona voiceRanges reajustando start/end del segundo renglon', () => {
    const dbSectionsVoice = [
      { type: 'chorus', lines: [
        { text: 'Nadie me ama como tu', voiceRanges: [{ start: 0, end: 5 }] },
        { text: 'me amas', voiceRanges: [{ start: 0, end: 2 }] },
      ] },
    ];
    const withVoice = buildReviewDoc({
      dbSections: dbSectionsVoice,
      canonical: null,
      transcription: { text: '', words: [], perLine: [], transLines: [] },
    });
    const d = applyReviewAction(withVoice, { type: 'mergeLines', section: 0, line: 0 });
    expect(d.sections[0].lines[0].voiceRanges).toEqual([{ start: 0, end: 5 }, { start: 21, end: 23 }]);
  });
  it('acceptVocalization la convierte en renglon vocalization tras la linea ancla', () => {
    const d = applyReviewAction(doc(), { type: 'acceptVocalization', index: 0, section: 0, afterLine: 1 });
    expect(d.sections[0].lines[2].vocalization).toBe(true);
    expect(d.vocalizations[0].accepted).toBe(true);
  });
  it('acceptVocalization con afterLine -1 (o null) ancla al inicio de la seccion', () => {
    const d1 = applyReviewAction(doc(), { type: 'acceptVocalization', index: 0, section: 0, afterLine: -1 });
    expect(d1.sections[0].lines[0].vocalization).toBe(true);
    expect(d1.sections[0].lines[0].text).toBe('oooh oh');
    const d2 = applyReviewAction(doc(), { type: 'acceptVocalization', index: 0, section: 0, afterLine: null });
    expect(d2.sections[0].lines[0].vocalization).toBe(true);
  });
  it('rejectVocalization marca accepted:false sin tocar los renglones', () => {
    const d = applyReviewAction(doc(), { type: 'rejectVocalization', index: 0 });
    expect(d.vocalizations[0].accepted).toBe(false);
    expect(d.sections[0].lines).toHaveLength(2);
  });
  it('setSectionType normaliza el tipo de la seccion', () => {
    const d = applyReviewAction(doc(), { type: 'setSectionType', section: 0, sectionType: 'estribillo' });
    expect(d.sections[0].type).toBe('chorus');
  });
  it('splitSection parte la seccion en el indice de linea dado', () => {
    const d = applyReviewAction(doc(), { type: 'splitSection', section: 0, afterLine: 0 });
    expect(d.sections).toHaveLength(2);
    expect(d.sections[0].lines).toHaveLength(1);
    expect(d.sections[0].lines[0].text).toBe('Nadie me ama como tu me amas');
    expect(d.sections[1].lines).toHaveLength(1);
    expect(d.sections[1].lines[0].text).toBe('y en la noche oscura brillara');
  });
  it('mergeSections une dos secciones contiguas', () => {
    const split = applyReviewAction(doc(), { type: 'splitSection', section: 0, afterLine: 0 });
    const merged = applyReviewAction(split, { type: 'mergeSections', section: 0 });
    expect(merged.sections).toHaveLength(1);
    expect(merged.sections[0].lines).toHaveLength(2);
  });
  it('accion sobre indice inexistente lanza RangeError', () => {
    expect(() => applyReviewAction(doc(), { type: 'resolve', section: 5, line: 0, choice: 'db' }))
      .toThrow(RangeError);
    expect(() => applyReviewAction(doc(), { type: 'resolve', section: 0, line: 9, choice: 'db' }))
      .toThrow(RangeError);
    expect(() => applyReviewAction(doc(), { type: 'rejectVocalization', index: 9 }))
      .toThrow(RangeError);
  });
  it('splitLine fuera de rango (afterWord invalido) lanza RangeError', () => {
    expect(() => applyReviewAction(doc(), { type: 'splitLine', section: 0, line: 0, afterWord: -1 }))
      .toThrow(RangeError);
    expect(() => applyReviewAction(doc(), { type: 'splitLine', section: 0, line: 0, afterWord: 6 }))
      .toThrow(RangeError); // 7 palabras, indice 6 = ultima -> segundo renglon vacio
  });
  it('splitSection en la ultima linea (seccion nueva vacia) lanza RangeError', () => {
    expect(() => applyReviewAction(doc(), { type: 'splitSection', section: 0, afterLine: 1 }))
      .toThrow(RangeError);
  });
});

// Mapa "seccion-linea" -> words de esa linea, mismo contrato que
// autoSplitLongLines espera como 2do parametro (ya correlacionado, no un
// array plano posicional -- ver bug de correlacion temporal mas abajo).
function wordsMap(entries) {
  return new Map(Object.entries(entries));
}

describe('autoSplitLongLines', () => {
  const longTokens = ['Uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
    'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce'];
  const longText = longTokens.join(' '); // 76 caracteres, > 48
  const wordsWithPause = makeWordsWithPauseAt(longTokens, 6); // pausa tras "siete"

  function docWithLine(line, { vocalizations = [] } = {}) {
    return {
      sections: [{ type: 'verse', label: 'Verso 1', lines: [line], temperature: 1 }],
      vocalizations,
      hasCanonical: false,
      temperature: 1,
    };
  }

  it('renglon largo con pausa entre palabras: parte en la pausa mas cercana al medio', () => {
    const line = {
      text: longText, conflict: false, vocalization: false, score: null,
      sources: { db: longText, canonical: null, trans: longText },
    };
    const doc = docWithLine(line);
    const out = autoSplitLongLines(doc, wordsMap({ '0-0': wordsWithPause }));
    expect(out.sections[0].lines).toHaveLength(2);
    expect(out.sections[0].lines[0].text).toBe('Uno dos tres cuatro cinco seis siete');
    expect(out.sections[0].lines[1].text).toBe('ocho nueve diez once doce trece catorce');
    expect(out.sections[0].lines[0].text.length).toBeLessThan(48);
    expect(out.sections[0].lines[1].text.length).toBeLessThan(48);
  });

  it('renglon largo sin words (solo canonica): corta en el espacio mas cercano al medio', () => {
    const text = 'Esta es una linea muy larga que no tiene ninguna transcripcion asociada todavia';
    const line = {
      text, conflict: false, vocalization: false, score: null,
      sources: { db: text, canonical: text, trans: null },
    };
    const doc = docWithLine(line);
    const out = autoSplitLongLines(doc);
    expect(out.sections[0].lines).toHaveLength(2);
    expect(out.sections[0].lines[0].text).toBe('Esta es una linea muy larga que no tiene');
    expect(out.sections[0].lines[1].text).toBe('ninguna transcripcion asociada todavia');
  });

  it('renglon corto (<=48 chars) queda intacto', () => {
    const text = 'Nadie me ama como tu me amas de verdad'; // 39 caracteres
    const line = {
      text, conflict: false, vocalization: false, score: null,
      sources: { db: text, canonical: null, trans: null },
    };
    const doc = docWithLine(line);
    const out = autoSplitLongLines(doc);
    expect(out.sections[0].lines).toHaveLength(1);
    expect(out.sections[0].lines[0].text).toBe(text);
  });

  it('reparte chords/voiceRanges por offset al partir (reusa la mecanica de splitLine)', () => {
    const line = {
      text: longText,
      conflict: false,
      vocalization: false,
      score: null,
      sources: { db: longText, canonical: null, trans: longText },
      chords: [{ ch: 'D', pos: 2 }, { ch: 'G', pos: 40 }],
      voiceRanges: [{ start: 0, end: 5 }, { start: 40, end: 45 }],
    };
    const doc = docWithLine(line);
    const out = autoSplitLongLines(doc, wordsMap({ '0-0': wordsWithPause }));
    const [first, second] = out.sections[0].lines;
    // cutOffset = "Uno dos tres cuatro cinco seis siete".length + 1 = 37
    expect(first.chords).toEqual([{ ch: 'D', pos: 2 }]);
    expect(second.chords).toEqual([{ ch: 'G', pos: 3 }]); // 40 - 37
    expect(first.voiceRanges).toEqual([{ start: 0, end: 5 }]);
    expect(second.voiceRanges).toEqual([{ start: 3, end: 8 }]); // 40-37, 45-37
  });

  it('aplicar dos veces es idempotente: no re-parte los hijos ya cortos', () => {
    const line = {
      text: longText, conflict: false, vocalization: false, score: null,
      sources: { db: longText, canonical: null, trans: longText },
    };
    const doc = docWithLine(line);
    const map = wordsMap({ '0-0': wordsWithPause });
    const once = autoSplitLongLines(doc, map);
    const twice = autoSplitLongLines(once, map);
    expect(twice).toEqual(once);
  });

  it('renglon muy largo con 2 pausas necesita 2 cortes (recursivo)', () => {
    const tokens = [...longTokens, 'quince', 'dieciseis', 'diecisiete', 'dieciocho'];
    const text = tokens.join(' '); // > 90 caracteres
    // primera pausa tras "siete" (idx 6); segunda tras "trece" (idx 12).
    const words = makeWordsWithPauseAt(tokens, 6);
    for (let i = 13; i < words.length; i += 1) {
      words[i] = { ...words[i], startMs: words[i].startMs + 800, endMs: words[i].endMs + 800 };
    }
    const line = {
      text, conflict: false, vocalization: false, score: null,
      sources: { db: text, canonical: null, trans: text },
    };
    const doc = docWithLine(line);
    const out = autoSplitLongLines(doc, wordsMap({ '0-0': words }));
    expect(out.sections[0].lines.length).toBeGreaterThanOrEqual(2);
    for (const l of out.sections[0].lines) {
      expect(l.text.length).toBeLessThanOrEqual(48);
    }
    expect(out.sections[0].lines.map((l) => l.text).join(' ')).toBe(text);
  });

  it('una sola palabra sin espacios mas larga que 48 chars queda intacta (sin loop infinito)', () => {
    const text = 'a'.repeat(60);
    const line = {
      text, conflict: false, vocalization: false, score: null,
      sources: { db: text, canonical: null, trans: null },
    };
    const doc = docWithLine(line);
    const out = autoSplitLongLines(doc);
    expect(out.sections[0].lines).toHaveLength(1);
    expect(out.sections[0].lines[0].text).toBe(text);
  });

  it('preserva orden de secciones y metadata (label/type) al partir', () => {
    const doc = {
      sections: [
        { type: 'verse', label: 'Verso 1', lines: [{ text: 'corto', conflict: false, vocalization: false, score: null, sources: { db: 'corto', canonical: null, trans: null } }], temperature: 1 },
        {
          type: 'chorus',
          label: 'Coro 1',
          lines: [{
            text: longText, conflict: false, vocalization: false, score: null,
            sources: { db: longText, canonical: null, trans: longText },
          }],
          temperature: 1,
        },
      ],
      vocalizations: [],
      hasCanonical: false,
      temperature: 1,
    };
    // la linea larga esta en seccion 1, linea 0 -> clave '1-0'.
    const out = autoSplitLongLines(doc, wordsMap({ '1-0': wordsWithPause }));
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].type).toBe('verse');
    expect(out.sections[0].lines).toHaveLength(1);
    expect(out.sections[1].type).toBe('chorus');
    expect(out.sections[1].label).toBe('Coro 1');
    expect(out.sections[1].lines).toHaveLength(2);
  });

  it('buildReviewDoc llama autoSplitLongLines al final: parte renglones largos con match de transcripcion', () => {
    const dbSectionsLong = [{ type: 'verse', lines: [{ text: longText }] }];
    const transcriptionLong = {
      text: longText,
      words: wordsWithPause,
      perLine: [{ transIndex: 0, dbIndex: 0, score: 1.0 }],
      transLines: [longText],
    };
    const doc = buildReviewDoc({ dbSections: dbSectionsLong, canonical: null, transcription: transcriptionLong });
    expect(doc.sections[0].lines).toHaveLength(2);
    expect(doc.sections[0].lines[0].text).toBe('Uno dos tres cuatro cinco seis siete');
    expect(doc.sections[0].lines[1].text).toBe('ocho nueve diez once doce trece catorce');
  });

  // Bug real (review Task 14): el orden del DOCUMENTO no es necesariamente
  // el orden TEMPORAL del audio. Con coros repetidos, la linea 0 del doc
  // puede matchear a un segmento transcrito que ocurrio DESPUES en el audio
  // que el de la linea 1 (transcribe_diff.py matchea cada linea db contra
  // su mejor candidato global, sin restriccion de orden). Si la correlacion
  // camina en orden de documento y corta el array de words por conteo
  // posicional, le asigna a cada linea el timing de OTRA linea -> corte
  // confiado pero en la pausa equivocada.
  it('correlaciona por transIndex (orden temporal real), no por orden del documento, con matching cruzado', () => {
    // segmentX: pausa tras idx 5 (temprana). segmentY: pausa tras idx 8 (tardia).
    const segmentX = makeWordsWithPauseAt(longTokens, 5);
    const segmentY = makeWordsWithPauseAt(longTokens, 8);
    // orden TEMPORAL real (como los devuelve Modal): segmentX primero, luego segmentY.
    const words = [...segmentX, ...segmentY];
    const transLines = [longText, longText]; // transIndex 0 = segmentX, transIndex 1 = segmentY
    // Matching CRUZADO: la linea 0 del doc (dbIndex 0) matchea con el
    // segmento que en el audio ocurrio SEGUNDO (transIndex 1, segmentY);
    // la linea 1 del doc (dbIndex 1) matchea con el que ocurrio PRIMERO
    // (transIndex 0, segmentX). Pasa perfectamente en coros repetidos.
    const perLine = [
      { transIndex: 0, dbIndex: 1, score: 1.0 },
      { transIndex: 1, dbIndex: 0, score: 1.0 },
    ];
    const dbSectionsCrossed = [{ type: 'chorus', lines: [{ text: longText }, { text: longText }] }];
    const doc = buildReviewDoc({
      dbSections: dbSectionsCrossed,
      canonical: null,
      transcription: { text: '', words, perLine, transLines },
    });
    // linea 0 (dbIndex 0) matchea transIndex 1 = segmentY -> pausa tras idx 8.
    expect(doc.sections[0].lines[0].text).toBe('Uno dos tres cuatro cinco seis siete ocho nueve');
    expect(doc.sections[0].lines[1].text).toBe('diez once doce trece catorce');
    // linea 1 (dbIndex 1) matchea transIndex 0 = segmentX -> pausa tras idx 5.
    expect(doc.sections[0].lines[2].text).toBe('Uno dos tres cuatro cinco seis');
    expect(doc.sections[0].lines[3].text).toBe('siete ocho nueve diez once doce trece catorce');
  });
});

describe('temperatura y aprobacion', () => {
  it('temperatura sube al resolver y canApprove exige 0 conflictos y 0 vocalizaciones sin decidir', () => {
    let d = buildReviewDoc({ dbSections, canonical, transcription });
    expect(canApprove(d)).toBe(false);
    d = applyReviewAction(d, { type: 'resolve', section: 0, line: 1, choice: 'canonical' });
    expect(reviewTemperature(d)).toBeGreaterThan(0.9);
    d = applyReviewAction(d, { type: 'rejectVocalization', index: 0 });
    expect(canApprove(d)).toBe(true);
  });
  it('approvedSnapshot produce sections para songs.sections + hash estable', () => {
    let d = buildReviewDoc({ dbSections, canonical, transcription });
    d = applyReviewAction(d, { type: 'resolve', section: 0, line: 1, choice: 'canonical' });
    d = applyReviewAction(d, { type: 'rejectVocalization', index: 0 });
    const snap = approvedSnapshot(d);
    expect(snap.sections[0].lines[1].text).toBe('y en la noche oscura brillará tu luz');
    expect(typeof snap.hash).toBe('string');
    expect(approvedSnapshot(d).hash).toBe(snap.hash); // determinista
  });
});
