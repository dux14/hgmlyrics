// tests/pipelineLyricsStore.test.js
import { describe, it, expect, vi } from 'vitest';
import { upsertPipelineLyrics, getPipelineLyrics } from '../api/_lib/pipeline/lyricsStore.js';

// Fake minimo del template tag de postgres.js: captura strings+valores y
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
