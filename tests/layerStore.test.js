import { describe, it, expect, beforeEach } from 'vitest';
import { getLayers, setLayer, deriveViewMode } from '../src/lib/layerStore.js';

describe('layerStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults a solo letra', () => {
    expect(getLayers()).toEqual({ chords: false, tono: false });
  });

  it('persiste toggles independientes', () => {
    setLayer('chords', true);
    setLayer('tono', true);
    expect(getLayers()).toEqual({ chords: true, tono: true });
  });

  it('permite apagar una capa sin afectar la otra', () => {
    setLayer('chords', true);
    setLayer('tono', true);
    setLayer('chords', false);
    expect(getLayers()).toEqual({ chords: false, tono: true });
  });

  it('tolera localStorage roto (getItem lanza)', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('boom');
    };
    expect(getLayers()).toEqual({ chords: false, tono: false });
    Storage.prototype.getItem = original;
  });

  it('tolera localStorage roto al persistir (setItem lanza)', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('boom');
    };
    expect(() => setLayer('chords', true)).not.toThrow();
    Storage.prototype.setItem = original;
  });

  it('tolera JSON malformado en storage (default)', () => {
    localStorage.setItem('hkn-lyrics-layers', '{not json');
    expect(getLayers()).toEqual({ chords: false, tono: false });
  });

  it('setLayer con nombre desconocido no hace nada', () => {
    setLayer('chords', true);
    setLayer('bogus', true);
    expect(getLayers()).toEqual({ chords: true, tono: false });
  });
});

describe('deriveViewMode', () => {
  it('ambas capas apagadas → lyrics', () => {
    expect(deriveViewMode({ chords: false, tono: false })).toBe('lyrics');
  });

  it('solo chords → chords', () => {
    expect(deriveViewMode({ chords: true, tono: false })).toBe('chords');
  });

  it('solo tono → tono', () => {
    expect(deriveViewMode({ chords: false, tono: true })).toBe('tono');
  });

  it('ambas capas encendidas → mixed', () => {
    expect(deriveViewMode({ chords: true, tono: true })).toBe('mixed');
  });
});
