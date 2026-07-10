import { describe, it, expect, beforeEach } from 'vitest';
import {
  getImmersiveMode,
  setImmersiveMode,
  inheritFromLayers,
  availableModes,
} from '../src/lib/immersiveStore.js';

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

  it('un valor persistido invalido cae a letra', () => {
    localStorage.setItem('hkn-immersive-mode', 'no-existe');
    expect(getImmersiveMode()).toBe('letra');
  });

  it('setImmersiveMode con valor invalido no persiste basura (queda letra)', () => {
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

  describe('inheritFromLayers', () => {
    it('ambos true -> mixed', () => {
      expect(inheritFromLayers({ chords: true, tono: true })).toBe('mixed');
    });

    it('solo chords -> chords', () => {
      expect(inheritFromLayers({ chords: true, tono: false })).toBe('chords');
    });

    it('solo tono -> tono', () => {
      expect(inheritFromLayers({ chords: false, tono: true })).toBe('tono');
    });

    it('ninguno -> letra', () => {
      expect(inheritFromLayers({ chords: false, tono: false })).toBe('letra');
    });

    it('no persiste en localStorage', () => {
      inheritFromLayers({ chords: true, tono: true });
      expect(localStorage.getItem('hkn-immersive-mode')).toBeNull();
    });
  });

  it('precedencia: si el usuario ya eligio un modo, inheritFromLayers no lo pisa (el caller debe respetar getImmersiveMode primero)', () => {
    setImmersiveMode('tono');
    // el patron de uso es: usar getImmersiveMode() si hay valor persistido,
    // inheritFromLayers solo como fallback de sesion sin eleccion previa.
    expect(getImmersiveMode()).toBe('tono');
    expect(inheritFromLayers({ chords: true, tono: false })).toBe('chords');
    expect(getImmersiveMode()).toBe('tono');
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
      expect(availableModes({ hasChords: true, tonoAvailable: false })).toEqual(['letra', 'chords']);
    });

    it('sin acordes ni tono: solo letra', () => {
      expect(availableModes({ hasChords: false, tonoAvailable: false })).toEqual(['letra']);
    });
  });
});
