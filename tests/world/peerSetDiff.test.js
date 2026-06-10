import { describe, it, expect } from 'vitest';
import { diffPeers } from '../../src/world/peerSetDiff.js';

describe('diffPeers', () => {
  it('detecta un peer nuevo en next (toAdd)', () => {
    const result = diffPeers(['a'], ['a', 'b'], 'self');
    expect(result.toAdd).toEqual(['b']);
    expect(result.toRemove).toEqual([]);
  });

  it('detecta un peer que se fue (toRemove)', () => {
    const result = diffPeers(['a', 'b'], ['a'], 'self');
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual(['b']);
  });

  it('sin cambios devuelve ambas listas vacías', () => {
    const result = diffPeers(['a', 'b'], ['a', 'b'], 'self');
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
  });

  it('excluye self de toAdd aunque aparezca en next', () => {
    const result = diffPeers(['a'], ['a', 'self'], 'self');
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
  });

  it('excluye self de toRemove aunque aparezca en current', () => {
    const result = diffPeers(['a', 'self'], ['a'], 'self');
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
  });

  it('excluye self de ambas listas cuando está en ambos arrays', () => {
    const result = diffPeers(['self', 'a'], ['self', 'b'], 'self');
    expect(result.toAdd).toEqual(['b']);
    expect(result.toRemove).toEqual(['a']);
  });

  it('acepta Sets como input', () => {
    const result = diffPeers(new Set(['a']), new Set(['a', 'b']), 'self');
    expect(result.toAdd).toEqual(['b']);
    expect(result.toRemove).toEqual([]);
  });

  it('current vacío → todo next es toAdd (sin self)', () => {
    const result = diffPeers([], ['a', 'b', 'self'], 'self');
    expect(result.toAdd).toEqual(['a', 'b']);
    expect(result.toRemove).toEqual([]);
  });

  it('next vacío → todo current es toRemove (sin self)', () => {
    const result = diffPeers(['a', 'b', 'self'], [], 'self');
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual(['a', 'b']);
  });
});
