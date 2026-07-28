import { describe, it, expect, beforeEach } from 'vitest';
import { getImmersiveMode, setImmersiveMode, availableModes } from '../src/lib/immersiveStore.js';

describe('immersiveStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('default es letra', () => {
    expect(getImmersiveMode()).toBe('letra');
  });

  it('setImmersiveMode persiste y getImmersiveMode lo devuelve', () => {
    setImmersiveMode('mixed');
    expect(getImmersiveMode()).toBe('mixed');
  });

  it('un valor persistido inválido cae a letra', () => {
    localStorage.setItem('hkn-immersive-mode', 'no-existe');
    expect(getImmersiveMode()).toBe('letra');
  });

  it('setImmersiveMode con valor inválido no persiste basura (queda letra)', () => {
    setImmersiveMode('no-existe');
    expect(getImmersiveMode()).toBe('letra');
  });

  it('tolera localStorage roto en getImmersiveMode', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('boom');
    };
    expect(getImmersiveMode()).toBe('letra');
    Storage.prototype.getItem = original;
  });

  it('tolera localStorage roto en setImmersiveMode', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('boom');
    };
    expect(() => setImmersiveMode('chords')).not.toThrow();
    Storage.prototype.setItem = original;
  });

  describe('availableModes', () => {
    it('con acordes y tono disponible: los 4 modos', () => {
      expect(availableModes({ hasChords: true, tonoAvailable: true })).toEqual([
        'letra',
        'chords',
        'mixed',
        'tono',
      ]);
    });

    it('sin acordes: sin chords ni mixed', () => {
      expect(availableModes({ hasChords: false, tonoAvailable: true })).toEqual(['letra', 'tono']);
    });

    it('sin tono disponible: sin tono ni mixed', () => {
      expect(availableModes({ hasChords: true, tonoAvailable: false })).toEqual([
        'letra',
        'chords',
      ]);
    });

    it('sin acordes ni tono: solo letra', () => {
      expect(availableModes({ hasChords: false, tonoAvailable: false })).toEqual(['letra']);
    });
  });
});
