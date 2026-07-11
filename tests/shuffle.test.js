import { describe, it, expect } from 'vitest';
import { seededShuffle, freshShuffle } from '../src/lib/shuffle.js';

describe('shuffle', () => {
  it('seededShuffle es determinista por seed', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(arr, 'a')).toEqual(seededShuffle(arr, 'a'));
    expect(seededShuffle(arr, 'a')).not.toEqual(arr);
  });
  it('freshShuffle conserva los elementos sin mutar el original', () => {
    const arr = [1, 2, 3, 4, 5];
    const out = freshShuffle(arr);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(arr).toEqual([1, 2, 3, 4, 5]);
  });
});
