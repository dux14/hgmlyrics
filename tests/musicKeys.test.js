import { describe, it, expect } from 'vitest';
import { MUSICAL_KEYS, isValidKey } from '../src/lib/musicKeys.js';

describe('MUSICAL_KEYS', () => {
  it('contains 24 keys (12 tonics × 2 modes)', () => {
    expect(MUSICAL_KEYS).toHaveLength(24);
  });

  it('has unique entries', () => {
    expect(new Set(MUSICAL_KEYS).size).toBe(24);
  });

  it('lists all major keys first, then all minor', () => {
    expect(MUSICAL_KEYS.slice(0, 12).every((k) => k.endsWith(' major'))).toBe(true);
    expect(MUSICAL_KEYS.slice(12).every((k) => k.endsWith(' minor'))).toBe(true);
  });

  it('includes canonical spellings', () => {
    expect(MUSICAL_KEYS).toContain('C major');
    expect(MUSICAL_KEYS).toContain('A minor');
    expect(MUSICAL_KEYS).toContain('F# major');
    expect(MUSICAL_KEYS).toContain('B minor');
  });

  it('uses sharps only (no flat-spelled keys)', () => {
    expect(MUSICAL_KEYS.some((k) => k.includes('b '))).toBe(false);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(MUSICAL_KEYS)).toBe(true);
  });
});

describe('isValidKey', () => {
  it('accepts every canonical key', () => {
    for (const k of MUSICAL_KEYS) expect(isValidKey(k)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isValidKey('X major')).toBe(false);
    expect(isValidKey('Bb major')).toBe(false); // not canonical (use A# major)
    expect(isValidKey('c major')).toBe(false); // lowercase
    expect(isValidKey('A')).toBe(false);
    expect(isValidKey('')).toBe(false);
    expect(isValidKey(null)).toBe(false);
    expect(isValidKey(undefined)).toBe(false);
    expect(isValidKey(42)).toBe(false);
  });
});
