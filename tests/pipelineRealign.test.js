import { describe, it, expect } from 'vitest';
import { clearManualOffsets, mergeAlignedLines } from '../api/_lib/pipeline/lyricsReview.js';
import { upsertPipelineLyrics } from '../api/_lib/pipeline/lyricsStore.js';

const doc = () => [
  {
    type: 'verse',
    lines: [
      { text: 'uno', startMs: 1000, manualStartMs: 1200, words: [{ word: 'uno' }] },
      { text: 'dos', startMs: 2000, manualStartMs: null },
    ],
  },
  { type: 'instrumental', startMs: 3000, endMs: 4000, lines: [] },
];

describe('clearManualOffsets', () => {
  it('limpia los manualStartMs sin tocar nada mas', () => {
    const out = clearManualOffsets(doc());
    expect(out[0].lines.map((l) => l.manualStartMs)).toEqual([null, null]);
    expect(out[0].lines[0]).toMatchObject({ startMs: 1000, text: 'uno', words: [{ word: 'uno' }] });
    expect(out[1]).toMatchObject({ startMs: 3000, endMs: 4000, lines: [] });
  });

  it('no muta el documento original', () => {
    const original = doc();
    clearManualOffsets(original);
    expect(original[0].lines[0].manualStartMs).toBe(1200);
  });
});

const withAnnotation = () => [
  {
    type: 'verse',
    lines: [
      { text: 'uno', startMs: null, endMs: null, words: [] },
      { text: '(coro)', annotation: true, startMs: null, words: [] },
      { text: 'dos', startMs: null, endMs: null, words: [] },
    ],
  },
];

describe('mergeAlignedLines', () => {
  it('escribe tiempos y palabras saltando las anotaciones', () => {
    const res = mergeAlignedLines(withAnnotation(), [
      {
        i: 0,
        startMs: 500,
        endMs: 900,
        words: [{ word: 'uno', startMs: 500, endMs: 900, score: 0.9 }],
      },
      {
        i: 1,
        startMs: 1500,
        endMs: 1900,
        words: [{ word: 'dos', startMs: 1500, endMs: 1900, score: 0.8 }],
      },
    ]);
    expect(res.error).toBeUndefined();
    expect(res.sections[0].lines[0].startMs).toBe(500);
    expect(res.sections[0].lines[0].words).toHaveLength(1);
    expect(res.sections[0].lines[2].startMs).toBe(1500);
  });

  it('deja la anotacion intacta', () => {
    const res = mergeAlignedLines(withAnnotation(), [
      { i: 0, startMs: 500, endMs: 900 },
      { i: 1, startMs: 1500, endMs: 1900 },
    ]);
    expect(res.sections[0].lines[1].startMs).toBeNull();
    expect(res.sections[0].lines[1].annotation).toBe(true);
  });

  it('acepta el formato viejo sin palabras', () => {
    const res = mergeAlignedLines(withAnnotation(), [
      { i: 0, startMs: 500 },
      { i: 1, startMs: 1500 },
    ]);
    expect(res.error).toBeUndefined();
    expect(res.sections[0].lines[0]).toMatchObject({ startMs: 500, words: [] });
  });

  it('rechaza sin escribir nada cuando la cantidad no calza', () => {
    const res = mergeAlignedLines(withAnnotation(), [{ i: 0, startMs: 500 }]);
    expect(res.error).toMatch(/no calza/i);
    expect(res.sections).toBeUndefined();
  });

  it('rechaza cuando falta un indice de la proyeccion', () => {
    const res = mergeAlignedLines(withAnnotation(), [
      { i: 0, startMs: 500 },
      { i: 5, startMs: 1500 },
    ]);
    expect(res.error).toBeTruthy();
    expect(res.sections).toBeUndefined();
  });

  it('no cuenta renglones de una seccion instrumental vacia', () => {
    const instrumental = [
      { type: 'instrumental', startMs: 0, endMs: 4000, lines: [] },
      { type: 'verse', lines: [{ text: 'uno', startMs: null, words: [] }] },
    ];
    const res = mergeAlignedLines(instrumental, [{ i: 0, startMs: 4200 }]);
    expect(res.sections[1].lines[0].startMs).toBe(4200);
  });
});

// Fake minimo del template tag de postgres.js (mismo patron que
// tests/pipelineLyricsStore.test.js).
function fakeSql(rows = []) {
  const calls = [];
  const tag = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  tag.json = (v) => ({ __json: v });
  tag.calls = calls;
  return tag;
}

describe('respaldo del realineado', () => {
  it('toda escritura del documento lo invalida', async () => {
    const sql = fakeSql([]);
    await upsertPipelineLyrics(sql, {
      songId: 's1',
      runId: 'r1',
      sections: [{ type: 'verse', lines: [] }],
      hash: 'abc123',
    });
    const { text } = sql.calls[0];
    expect(text).toMatch(/previous_sections = null/i);
    expect(text).toMatch(/previous_hash = null/i);
    expect(text).toMatch(/realigned_at = null/i);
  });
});
