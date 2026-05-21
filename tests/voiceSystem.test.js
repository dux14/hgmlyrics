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
