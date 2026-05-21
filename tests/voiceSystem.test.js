import { describe, it, expect } from 'vitest';
import { buildHighlightedHTML } from '../src/lib/voiceSystem.js';

describe('buildHighlightedHTML — new signature (no defaultVoices)', () => {
  it('returns escaped text when voiceRanges is empty', () => {
    expect(buildHighlightedHTML('hola', [])).toBe('hola');
  });

  it('returns empty string for empty text + empty ranges', () => {
    expect(buildHighlightedHTML('', [])).toBe('');
  });
});

describe('buildHighlightedHTML — single voice range', () => {
  it('wraps the range slice with 1 underline', () => {
    const html = buildHighlightedHTML('hola', [{ start: 0, end: 4, voices: ['soprano'] }]);
    expect(html).toContain('voice-underline--soprano');
    expect(html).toContain('hola');
    expect(html.match(/voice-underline--/g) || []).toHaveLength(1);
  });

  it('wraps only the range, leaves gap text plain', () => {
    const html = buildHighlightedHTML('hola mundo', [{ start: 5, end: 10, voices: ['tenor'] }]);
    expect(html).toContain('hola ');
    expect(html).toContain('mundo');
    expect(html).toContain('voice-underline--tenor');
  });
});

describe('buildHighlightedHTML — multi-voice', () => {
  it('renders 2 underlines for 2 voices in canonical order regardless of input order', () => {
    const a = buildHighlightedHTML('hi', [{ start: 0, end: 2, voices: ['soprano', 'tenor'] }]);
    const b = buildHighlightedHTML('hi', [{ start: 0, end: 2, voices: ['tenor', 'soprano'] }]);
    expect(a).toBe(b);
    expect(a).toContain('voice-underline--soprano');
    expect(a).toContain('voice-underline--tenor');
    // Soprano comes BEFORE tenor in HTML (canonical order: sop, contralto, tenor, bass)
    expect(a.indexOf('voice-underline--soprano')).toBeLessThan(a.indexOf('voice-underline--tenor'));
  });

  it('renders 4 underlines for all voices', () => {
    const html = buildHighlightedHTML('hi', [
      { start: 0, end: 2, voices: ['soprano', 'contralto', 'tenor', 'bass'] },
    ]);
    expect(html.match(/voice-underline--/g) || []).toHaveLength(4);
  });

  it('silently skips invalid voice IDs', () => {
    const html = buildHighlightedHTML('hi', [
      { start: 0, end: 2, voices: ['soprano', 'invalid_id'] },
    ]);
    expect(html.match(/voice-underline--/g) || []).toHaveLength(1);
    expect(html).toContain('voice-underline--soprano');
  });
});

describe('buildHighlightedHTML — contiguous + gap slices', () => {
  it('renders two contiguous ranges as separate slices', () => {
    const html = buildHighlightedHTML('hola', [
      { start: 0, end: 2, voices: ['soprano'] },
      { start: 2, end: 4, voices: ['bass'] },
    ]);
    expect(html).toContain('voice-underline--soprano');
    expect(html).toContain('voice-underline--bass');
  });

  it('escapes HTML special chars in text', () => {
    const html = buildHighlightedHTML('a<b>c&d"e', []);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });
});
