import { describe, it, expect } from 'vitest';
import { isFounder, founderCrownHtml } from './founders.js';

describe('isFounder', () => {
  it('returns true for mari', () => expect(isFounder('mari')).toBe(true));
  it('returns true for Mari (case-insensitive)', () => expect(isFounder('Mari')).toBe(true));
  it('returns true for samu', () => expect(isFounder('samu')).toBe(true));
  it('returns false for a random user', () => expect(isFounder('juan')).toBe(false));
  it('returns false for empty string', () => expect(isFounder('')).toBe(false));
  it('returns false for null', () => expect(isFounder(null)).toBe(false));
  it('returns false for undefined', () => expect(isFounder(undefined)).toBe(false));
});

describe('founderCrownHtml', () => {
  it('contains href="#founder-crown" sprite reference', () =>
    expect(founderCrownHtml()).toContain('href="#founder-crown"'));
  it('contains avatar-crown class', () => expect(founderCrownHtml()).toContain('avatar-crown'));
  it('has aria-hidden="true"', () => expect(founderCrownHtml()).toContain('aria-hidden="true"'));
});
