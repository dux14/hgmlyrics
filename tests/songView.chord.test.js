/**
 * songView.chord.test.js — Integration tests for chord line + voiceRanges
 */
import { describe, it, expect } from 'vitest';

// Note: buildInlineChordHTML is not exported. We can only test indirectly via render.
// But we can verify the output STRUCTURE assumptions by inspecting voiceSystem.js helpers
// and document the contract here for future test expansion.

import { buildHighlightedHTML } from '../src/lib/voiceSystem.js';

describe('chord-line + voiceRanges contract', () => {
  it('buildHighlightedHTML on a chord segment substring produces colored-text spans for matching ranges', () => {
    // Simulates what sliceRangesForSegment + buildHighlightedHTML produces inside one chord segment
    const segText = 'mun';
    const segRanges = [{ start: 0, end: 3, voices: ['soprano'] }];
    const html = buildHighlightedHTML(segText, segRanges, 'all');
    expect(html).toContain('voice-text--soprano');
    expect(html).toContain('mun');
  });

  it('empty voiceRanges produces plain escaped text', () => {
    const html = buildHighlightedHTML('hi <b>', []);
    expect(html).toBe('hi &lt;b&gt;');
  });
});
