import { describe, it, expect } from 'vitest';
import { shouldOffer } from '../../src/world/voiceGlare.js';

describe('shouldOffer', () => {
  it('devuelve false cuando los ids son iguales', () => {
    expect(shouldOffer('abc', 'abc')).toBe(false);
  });

  it('devuelve true cuando myId es lexicograficamente mayor que peerId', () => {
    expect(shouldOffer('b', 'a')).toBe(true);
    expect(shouldOffer('z-uuid', 'a-uuid')).toBe(true);
  });

  it('devuelve false cuando myId es lexicograficamente menor que peerId', () => {
    expect(shouldOffer('a', 'b')).toBe(false);
    expect(shouldOffer('a-uuid', 'z-uuid')).toBe(false);
  });
});
