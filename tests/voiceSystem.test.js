import { describe, it, expect } from 'vitest';
import {
  buildHighlightedHTML,
  validateVoiceRanges,
  CANONICAL_VOICE_ORDER,
} from '../src/lib/voiceSystem.js';

describe('CANONICAL_VOICE_ORDER', () => {
  it('is soprano > contralto > tenor > bass', () => {
    expect(CANONICAL_VOICE_ORDER).toEqual(['soprano', 'contralto', 'tenor', 'bass']);
  });
});

describe('buildHighlightedHTML — empty / no ranges', () => {
  it('returns escaped text when voiceRanges is empty', () => {
    expect(buildHighlightedHTML('hola', [])).toBe('hola');
  });

  it('returns empty string for empty text + empty ranges', () => {
    expect(buildHighlightedHTML('', [])).toBe('');
  });

  it('escapes HTML special chars in plain text', () => {
    const html = buildHighlightedHTML('a<b>c&d"e', []);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('with activeVoice="all" and no ranges, returns bare escaped text (no spans)', () => {
    expect(buildHighlightedHTML('hola', [], 'all')).toBe('hola');
  });

  it('with activeVoice="soprano" and no ranges, wraps text in dimmed span', () => {
    const html = buildHighlightedHTML('hola', [], 'soprano');
    expect(html).toContain('voice-text--dimmed');
    expect(html).toContain('hola');
  });
});

describe('buildHighlightedHTML — activeVoice="all"', () => {
  it('colors a single-voice range with its color class', () => {
    const html = buildHighlightedHTML('Señor', [{ start: 0, end: 5, voices: ['soprano'] }], 'all');
    expect(html).toContain('voice-text--soprano');
    expect(html).toContain('Señor');
  });

  it('colors multi-voice range with FIRST canonical voice', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['tenor', 'soprano'] }],
      'all',
    );
    expect(html).toContain('voice-text--soprano');
    expect(html).not.toContain('voice-text--tenor');
  });

  it('appends +N badge for multi-voice range (N = extras count)', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['soprano', 'contralto', 'tenor'] }],
      'all',
    );
    expect(html).toContain('voice-badge-extra');
    expect(html).toContain('+2');
  });

  it('badge color class matches SECOND canonical voice', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['contralto', 'soprano'] }],
      'all',
    );
    expect(html).toContain('voice-badge-extra--contralto');
  });

  it('no badge for single-voice range', () => {
    const html = buildHighlightedHTML('Señor', [{ start: 0, end: 5, voices: ['soprano'] }], 'all');
    expect(html).not.toContain('voice-badge-extra');
  });

  it('plain gap text outside any range is bare (no span)', () => {
    const html = buildHighlightedHTML(
      'hola mundo',
      [{ start: 5, end: 10, voices: ['tenor'] }],
      'all',
    );
    expect(html.startsWith('hola ')).toBe(true);
    expect(html).toContain('voice-text--tenor');
  });
});

describe('buildHighlightedHTML — activeVoice="soprano" (specific voice)', () => {
  it('renders matching range with voice color, no dim, no badge', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['soprano', 'contralto'] }],
      'soprano',
    );
    expect(html).toContain('voice-text--soprano');
    expect(html).not.toContain('voice-text--dimmed');
    expect(html).not.toContain('voice-badge-extra');
  });

  it('renders non-matching range with dimmed class only', () => {
    const html = buildHighlightedHTML(
      'Señor',
      [{ start: 0, end: 5, voices: ['contralto'] }],
      'soprano',
    );
    expect(html).toContain('voice-text--dimmed');
    expect(html).not.toContain('voice-text--soprano');
    expect(html).not.toContain('voice-text--contralto');
  });

  it('dims plain gap text outside any range', () => {
    const html = buildHighlightedHTML(
      'hola mundo',
      [{ start: 5, end: 10, voices: ['soprano'] }],
      'soprano',
    );
    expect(html).toContain('voice-text--dimmed');
    expect(html).toContain('voice-text--soprano');
    const dimmedCount = (html.match(/voice-text--dimmed/g) || []).length;
    expect(dimmedCount).toBe(1);
  });
});

describe('buildHighlightedHTML — contiguous ranges + invalid IDs', () => {
  it('renders two contiguous ranges as separate spans (all mode)', () => {
    const html = buildHighlightedHTML(
      'hola',
      [
        { start: 0, end: 2, voices: ['soprano'] },
        { start: 2, end: 4, voices: ['bass'] },
      ],
      'all',
    );
    expect(html).toContain('voice-text--soprano');
    expect(html).toContain('voice-text--bass');
  });

  it('silently skips invalid voice IDs when computing first voice', () => {
    const html = buildHighlightedHTML(
      'hi',
      [{ start: 0, end: 2, voices: ['invalid_id', 'soprano'] }],
      'all',
    );
    expect(html).toContain('voice-text--soprano');
    expect(html).not.toContain('voice-text--invalid_id');
  });

  it('drops range entirely if all voice IDs invalid', () => {
    const html = buildHighlightedHTML('hi', [{ start: 0, end: 2, voices: ['bogus'] }], 'all');
    expect(html).not.toContain('voice-text--');
    expect(html).toContain('hi');
  });
});

describe('validateVoiceRanges', () => {
  it('trims ranges that exceed text length', () => {
    expect(validateVoiceRanges([{ start: 0, end: 10, voices: ['soprano'] }], 5)).toEqual([
      { start: 0, end: 5, voices: ['soprano'] },
    ]);
  });

  it('drops ranges entirely outside text length', () => {
    expect(validateVoiceRanges([{ start: 10, end: 20, voices: ['soprano'] }], 5)).toEqual([]);
  });

  it('drops ranges with empty voices array', () => {
    expect(validateVoiceRanges([{ start: 0, end: 3, voices: [] }], 100)).toEqual([]);
  });

  it('reorders by start ascending', () => {
    const out = validateVoiceRanges(
      [
        { start: 5, end: 10, voices: ['bass'] },
        { start: 0, end: 3, voices: ['soprano'] },
      ],
      100,
    );
    expect(out).toEqual([
      { start: 0, end: 3, voices: ['soprano'] },
      { start: 5, end: 10, voices: ['bass'] },
    ]);
  });

  it('returns [] for null/undefined input', () => {
    expect(validateVoiceRanges(null, 10)).toEqual([]);
    expect(validateVoiceRanges(undefined, 10)).toEqual([]);
  });

  it('drops ranges where start >= end after trimming', () => {
    expect(validateVoiceRanges([{ start: 5, end: 10, voices: ['soprano'] }], 5)).toEqual([]);
  });
});
