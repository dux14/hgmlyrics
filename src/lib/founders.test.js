import { describe, it, expect } from 'vitest';
import { isFounder } from './founders.js';

describe('isFounder', () => {
  it('returns true for mari', () => expect(isFounder('mari')).toBe(true));
  it('returns true for Mari (case-insensitive)', () => expect(isFounder('Mari')).toBe(true));
  it('returns true for samu', () => expect(isFounder('samu')).toBe(true));
  it('returns false for a random user', () => expect(isFounder('juan')).toBe(false));
  it('returns false for empty string', () => expect(isFounder('')).toBe(false));
  it('returns false for null', () => expect(isFounder(null)).toBe(false));
  it('returns false for undefined', () => expect(isFounder(undefined)).toBe(false));
});
