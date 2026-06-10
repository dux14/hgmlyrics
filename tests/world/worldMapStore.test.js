/**
 * worldMapStore.test.js — Pruebas del descriptor del mapa activo.
 */
import { describe, it, expect } from 'vitest';
import { getActiveMapDescriptor } from '../../src/world/worldMapStore.js';

describe('getActiveMapDescriptor', () => {
  it('devuelve el descriptor del mapa dev con key, url y tileset', () => {
    const d = getActiveMapDescriptor();
    expect(d.key).toBeTruthy();
    expect(d.url).toBe('/world/dev-map.json');
    expect(d.tilesetKey).toBeTruthy();
    expect(d.tilesetUrl).toBe('/world/dev-tileset.png');
    expect(d.tilesetName).toBe('dev-tileset');
  });

  it('devuelve una copia nueva en cada llamada (no expone el estado interno)', () => {
    const a = getActiveMapDescriptor();
    const b = getActiveMapDescriptor();
    expect(a).not.toBe(b);
    a.url = 'mutado';
    expect(getActiveMapDescriptor().url).toBe('/world/dev-map.json');
  });
});
