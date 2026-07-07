/**
 * transposeStore.test.js — Persistencia de transposición por canción (T3).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getTranspose, setTranspose } from '../src/lib/transposeStore.js';

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

  it('clampea semitonos fuera de rango [-11, 11]', () => {
    setTranspose('song-1', { semitones: 40, useFlats: false });
    expect(getTranspose('song-1').semitones).toBe(11);
    setTranspose('song-1', { semitones: -40, useFlats: false });
    expect(getTranspose('song-1').semitones).toBe(-11);
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
