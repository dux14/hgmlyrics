/**
 * songView.chord.test.js — Integration tests for chord line + voiceRanges
 */
import { describe, it, expect } from 'vitest';

// Note: buildInlineChordHTML is not exported. We can only test indirectly via render.
// But we can verify the output STRUCTURE assumptions by inspecting voiceSystem.js helpers
// and document the contract here for future test expansion.

import { buildHighlightedHTML } from '../src/lib/voiceSystem.js';
import { buildChordsLineHTML } from '../src/lib/lyricsRender.js';

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

describe('buildChordsLineHTML — notación latina (display layer, T1)', () => {
  it('con notation latin pinta "Sol" en vez de "G"', () => {
    const html = buildChordsLineHTML('Santo', [{ pos: 0, ch: 'G' }], { notation: 'latin' });
    expect(html).toContain('Sol');
    expect(html).not.toContain('>G<');
  });

  it('sin notation (default anglo) pinta el símbolo original', () => {
    const html = buildChordsLineHTML('Santo', [{ pos: 0, ch: 'G' }]);
    expect(html).toContain('>G<');
  });

  it('notation latin + transposición combinan: transpone primero, traduce después', () => {
    const html = buildChordsLineHTML('Santo', [{ pos: 0, ch: 'C' }], {
      transposeSemitones: 2,
      notation: 'latin',
    });
    // C + 2 semitonos = D → Re
    expect(html).toContain('Re');
  });
});
