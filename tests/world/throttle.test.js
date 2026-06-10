import { describe, it, expect } from 'vitest';
import { makeRateLimiter } from '../../src/world/throttle.js';

describe('makeRateLimiter', () => {
  it('no deja pasar más de 1 evento por intervalo', () => {
    const limiter = makeRateLimiter(100); // 100ms = 10Hz
    expect(limiter(1000)).toBe(true);
    expect(limiter(1050)).toBe(false);
    expect(limiter(1101)).toBe(true);
  });
});
