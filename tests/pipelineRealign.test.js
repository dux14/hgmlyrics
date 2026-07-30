import { describe, it, expect } from 'vitest';
import { clearManualOffsets } from '../api/_lib/pipeline/lyricsReview.js';

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
