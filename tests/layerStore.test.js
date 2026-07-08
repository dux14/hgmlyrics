import { describe, it, expect, beforeEach } from 'vitest';
import { getLayers, setLayer } from '../src/lib/layerStore.js';

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
});
