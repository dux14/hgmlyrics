// tests/pipelineLyricsStore.test.js
import { describe, it, expect } from 'vitest';
import {
  upsertPipelineLyrics,
  getPipelineLyrics,
  pipelineLinesFor,
} from '../api/_lib/pipeline/lyricsStore.js';

// Fake mínimo del template tag de postgres.js: captura strings+valores y
// devuelve lo programado. sql.json marca el valor (como el driver real).
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

const SECTIONS = [
  {
    type: 'verse', label: null, startMs: 0, endMs: 9000,
    lines: [{
      text: 'hola mundo', startMs: 100, endMs: 900,
      words: [
        { word: 'hola', startMs: 100, endMs: 400, score: 0.9 },
        { word: 'mundo', startMs: 500, endMs: 900, score: 0.8 },
      ],
      confidence: 0.85, vocalization: false, breath: false, manualStartMs: null,
    }],
  },
];

describe('upsertPipelineLyrics', () => {
  it('hace upsert por song_id con sections como json y devuelve la promesa del driver', async () => {
    const sql = fakeSql([]);
    await upsertPipelineLyrics(sql, {
      songId: 's1', runId: 'r1', sections: SECTIONS, hash: 'abc123',
    });
    expect(sql.calls).toHaveLength(1);
    const { text, values } = sql.calls[0];
    expect(text).toMatch(/INSERT INTO song_pipeline_lyrics/i);
    expect(text).toMatch(/ON CONFLICT \(song_id\) DO UPDATE/i);
    expect(values).toContainEqual('s1');
    expect(values).toContainEqual('r1');
    expect(values).toContainEqual('abc123');
    expect(values).toContainEqual({ __json: SECTIONS });
  });
});

describe('getPipelineLyrics', () => {
  it('devuelve la fila mapeada cuando existe', async () => {
    const sql = fakeSql([
      { songId: 's1', runId: 'r1', sections: SECTIONS, hash: 'abc123', approvedAt: '2026-07-23T00:00:00Z' },
    ]);
    const row = await getPipelineLyrics(sql, 's1');
    expect(row).toEqual({
      songId: 's1', runId: 'r1', sections: SECTIONS, hash: 'abc123', approvedAt: '2026-07-23T00:00:00Z',
    });
    expect(sql.calls[0].text).toMatch(/FROM song_pipeline_lyrics/i);
    expect(sql.calls[0].values).toEqual(['s1']);
  });

  it('devuelve null sin fila', async () => {
    const sql = fakeSql([]);
    expect(await getPipelineLyrics(sql, 'nope')).toBeNull();
  });
});

describe('pipelineLinesFor', () => {
  const mkLine = (text, startMs, words = [], manualStartMs = null) => ({
    text,
    startMs,
    endMs: startMs,
    words,
    confidence: null,
    vocalization: false,
    breath: false,
    manualStartMs,
  });
  const mkSection = (lines) => ({ type: 'verse', label: null, startMs: 0, endMs: 0, lines });

  it('aplana en orden de documento, saltando secciones sin renglones', () => {
    const sections = [
      mkSection([mkLine('a', 0), mkLine('b', 1000)]),
      mkSection([]), // seccion sin lineas (ej. un puente vacio)
      mkSection([mkLine('c', 2000)]),
    ];
    const lines = pipelineLinesFor(sections);
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('endMs sale de la ultima word del renglon cuando hay words', () => {
    const sections = [
      mkSection([
        mkLine('a', 0, [
          { word: 'a', startMs: 0, endMs: 200, score: 0.9 },
          { word: 'b', startMs: 200, endMs: 300, score: 0.8 },
        ]),
        mkLine('c', 1000),
      ]),
    ];
    const lines = pipelineLinesFor(sections);
    expect(lines[0]).toMatchObject({ text: 'a', startMs: 0, endMs: 300 });
  });

  it('sin words, endMs cae al startMs de la linea siguiente', () => {
    const sections = [mkSection([mkLine('a', 0), mkLine('b', 1000)])];
    const lines = pipelineLinesFor(sections);
    expect(lines[0]).toMatchObject({ text: 'a', startMs: 0, endMs: 1000 });
  });

  it('renglones sin startMs propio interpolan el punto medio, misma monotonia que timingLinesFromSections', () => {
    const sections = [mkSection([mkLine('a', 0), mkLine('b', null), mkLine('c', 1000)])];
    const lines = pipelineLinesFor(sections);
    expect(lines[1]).toMatchObject({ text: 'b', startMs: 500, endMs: 1000 });
    expect(lines[2]).toMatchObject({ text: 'c', startMs: 1000 });
  });

  it('la monotonia estricta de los startMs se preserva (dos renglones con el mismo startMs)', () => {
    const sections = [mkSection([mkLine('a', 0), mkLine('b', 0), mkLine('c', 1)])];
    const lines = pipelineLinesFor(sections);
    expect(lines[1].startMs).toBeGreaterThan(lines[0].startMs);
    expect(lines[2].startMs).toBeGreaterThan(lines[1].startMs);
  });

  it('ultima linea del documento: sin words, endMs es su propio startMs', () => {
    const sections = [mkSection([mkLine('a', 0), mkLine('b', 1000)])];
    const lines = pipelineLinesFor(sections);
    expect(lines[1]).toMatchObject({ text: 'b', startMs: 1000, endMs: 1000 });
  });

  it('documento de una sola linea: startMs y endMs coinciden', () => {
    const sections = [mkSection([mkLine('unica', 500)])];
    const lines = pipelineLinesFor(sections);
    expect(lines).toEqual([{ text: 'unica', startMs: 500, endMs: 500 }]);
  });

  // Hallazgo Critical del review: startMs (timingLinesFromSections) y endMs
  // (ultima word del renglon) son dos fuentes que pueden desincronizarse. Sin
  // clamp, ese intervalo invertido llega tal cual al forced align en GPU.
  it('offset manual muy adelantado a sus propias words: el endMs se clampea, no queda invertido', () => {
    const sections = [
      mkSection([
        mkLine('a', 0, [{ word: 'a', startMs: 0, endMs: 300, score: 0.9 }], 5000),
        mkLine('b', 6000),
      ]),
    ];
    const lines = pipelineLinesFor(sections);
    expect(lines[0]).toMatchObject({ text: 'a', startMs: 5000 });
    expect(lines[0].endMs).toBeGreaterThan(lines[0].startMs);
  });

  it('dos renglones adyacentes con el mismo startMs del ASR: el bump de monotonia no invierte el endMs propio', () => {
    const sections = [
      mkSection([
        mkLine('a', 1000, [{ word: 'a', startMs: 1000, endMs: 1000, score: 0.9 }]),
        mkLine('b', 1000, [{ word: 'b', startMs: 1000, endMs: 1000, score: 0.9 }]),
        mkLine('c', 2000),
      ]),
    ];
    const lines = pipelineLinesFor(sections);
    // El bump de monotonia estricta de timingLinesFromSections empuja 'b' a
    // 1001; su word endMs (1000, sin reajustar) quedaria por debajo sin clamp.
    expect(lines[1].startMs).toBe(1001);
    expect(lines[1].endMs).toBeGreaterThan(lines[1].startMs);
  });

  it('invariante: endMs > startMs en todo renglon salvo el ultimo (que por diseno queda endMs === startMs)', () => {
    const sections = [
      mkSection([
        mkLine('a', 0, [{ word: 'a', startMs: 0, endMs: 300, score: 0.9 }], 5000),
        mkLine('b', 1000, [{ word: 'b', startMs: 1000, endMs: 1000, score: 0.9 }]),
        mkLine('c', 1000, [{ word: 'c', startMs: 1000, endMs: 1000, score: 0.9 }]),
        mkLine('d', null),
        mkLine('e', 2000),
      ]),
    ];
    const lines = pipelineLinesFor(sections);
    lines.slice(0, -1).forEach((l) => expect(l.endMs).toBeGreaterThan(l.startMs));
    const last = lines[lines.length - 1];
    expect(last.endMs).toBe(last.startMs);
  });
});
