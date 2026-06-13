/**
 * voicePolicy.test.js — Pruebas TDD de capPublishers().
 */

import { describe, it, expect } from 'vitest';
import { capPublishers } from '../../src/world/voicePolicy.js';

describe('capPublishers', () => {
  it('retorna la lista completa cuando hay menos peers que el max', () => {
    const ids = ['uid-b', 'uid-a', 'uid-c'];
    const result = capPublishers(ids, 8);
    expect(result).toHaveLength(3);
  });

  it('retorna exactamente max peers cuando la lista supera el cap', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const result = capPublishers(ids, 8);
    expect(result).toHaveLength(8);
  });

  it('la seleccion es determinista: siempre los primeros en orden lex', () => {
    const ids = ['uid-z', 'uid-a', 'uid-m', 'uid-b'];
    const result = capPublishers(ids, 2);
    expect(result).toEqual(['uid-a', 'uid-b']);
  });

  it('todos los clientes obtienen el mismo subconjunto independientemente del orden de entrada', () => {
    const ids1 = ['uid-c', 'uid-a', 'uid-b', 'uid-d'];
    const ids2 = ['uid-d', 'uid-b', 'uid-a', 'uid-c'];
    expect(capPublishers(ids1, 3)).toEqual(capPublishers(ids2, 3));
  });

  it('max por defecto es 8', () => {
    const ids = Array.from({ length: 12 }, (_, i) => 'uid-' + String(i).padStart(3, '0'));
    const result = capPublishers(ids);
    expect(result).toHaveLength(8);
  });

  it('max=0 retorna lista vacía', () => {
    expect(capPublishers(['uid-a', 'uid-b'], 0)).toEqual([]);
  });

  it('lista vacía retorna lista vacía', () => {
    expect(capPublishers([], 8)).toEqual([]);
  });

  it('retorna el array ordenado (lex)', () => {
    const ids = ['uid-c', 'uid-a', 'uid-b'];
    const result = capPublishers(ids, 10);
    expect(result).toEqual(['uid-a', 'uid-b', 'uid-c']);
  });

  it('no muta el array original', () => {
    const ids = ['uid-b', 'uid-a'];
    const original = [...ids];
    capPublishers(ids, 8);
    expect(ids).toEqual(original);
  });
});
