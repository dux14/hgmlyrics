/**
 * transposeStore.test.js — Persistencia de transposición por canción (T3).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getTranspose, setTranspose, normalizeSemitones } from '../src/lib/transposeStore.js';

describe('getTranspose / setTranspose', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sin guardar devuelve default 0/false', () => {
    expect(getTranspose('song-1')).toEqual({ semitones: 0, useFlats: false });
  });

  it('persiste y recupera semitones + useFlats', () => {
    setTranspose('song-1', { semitones: 3, useFlats: true });
    expect(getTranspose('song-1')).toEqual({ semitones: 3, useFlats: true });
  });

  it('es independiente por canción', () => {
    setTranspose('song-1', { semitones: 2, useFlats: false });
    setTranspose('song-2', { semitones: -5, useFlats: true });
    expect(getTranspose('song-1')).toEqual({ semitones: 2, useFlats: false });
    expect(getTranspose('song-2')).toEqual({ semitones: -5, useFlats: true });
  });

  it('normaliza semitonos fuera de rango [-11, 11] por wrap simétrico (FIX 1, no clamp)', () => {
    setTranspose('song-1', { semitones: 40, useFlats: false });
    expect(getTranspose('song-1').semitones).toBe(4); // 40 = 3*12 + 4
    setTranspose('song-1', { semitones: -40, useFlats: false });
    expect(getTranspose('song-1').semitones).toBe(-4);
  });

  it('datos legacy en el límite exacto (±12) caen a 0 en vez de crashear', () => {
    setTranspose('song-1', { semitones: 12, useFlats: false });
    expect(getTranspose('song-1').semitones).toBe(0);
    setTranspose('song-1', { semitones: -12, useFlats: false });
    expect(getTranspose('song-1').semitones).toBe(0);
  });

  it('valor no entero cae a 0', () => {
    setTranspose('song-1', { semitones: 2.5, useFlats: false });
    expect(getTranspose('song-1').semitones).toBe(0);
  });

  it('sin songId no crashea (no-op)', () => {
    expect(() => setTranspose(null, { semitones: 2, useFlats: false })).not.toThrow();
    expect(getTranspose(null)).toEqual({ semitones: 0, useFlats: false });
    expect(getTranspose(undefined)).toEqual({ semitones: 0, useFlats: false });
  });

  it('storage con JSON roto no crashea, cae a default', () => {
    localStorage.setItem('hkn-transpose:song-1', '{not json');
    expect(getTranspose('song-1')).toEqual({ semitones: 0, useFlats: false });
  });

  it('localStorage.getItem que lanza no crashea (Safari privado/cuota)', () => {
    const original = localStorage.getItem;
    localStorage.getItem = () => {
      throw new Error('quota exceeded');
    };
    expect(() => getTranspose('song-1')).not.toThrow();
    expect(getTranspose('song-1')).toEqual({ semitones: 0, useFlats: false });
    localStorage.getItem = original;
  });

  it('localStorage.setItem que lanza no crashea', () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('quota exceeded');
    };
    expect(() => setTranspose('song-1', { semitones: 2, useFlats: false })).not.toThrow();
    localStorage.setItem = original;
  });
});

describe('normalizeSemitones (FIX 1 — wrap simétrico del contador vivo)', () => {
  it('valores dentro de [-11, 11] quedan intactos', () => {
    expect(normalizeSemitones(0)).toBe(0);
    expect(normalizeSemitones(11)).toBe(11);
    expect(normalizeSemitones(-11)).toBe(-11);
  });

  it('+12 y −12 continúan el ciclo hacia 0', () => {
    expect(normalizeSemitones(12)).toBe(0);
    expect(normalizeSemitones(-12)).toBe(0);
  });

  it('+13 continúa el ciclo hacia +1, no salta a −11', () => {
    expect(normalizeSemitones(13)).toBe(1);
    expect(normalizeSemitones(-13)).toBe(-1);
  });

  it('subir 12 veces desde 0 vuelve a 0 (equivalente musical, Original)', () => {
    let semitones = 0;
    for (let i = 0; i < 12; i++) semitones = normalizeSemitones(semitones + 1);
    expect(semitones).toBe(0);
  });

  it('entrada no entera cae a 0', () => {
    expect(normalizeSemitones(2.5)).toBe(0);
    expect(normalizeSemitones(NaN)).toBe(0);
  });

  it('round-trip exacto vía store: normaliza en escritura Y en lectura', () => {
    setTranspose('song-1', { semitones: normalizeSemitones(13), useFlats: false });
    expect(getTranspose('song-1').semitones).toBe(1);
  });
});
