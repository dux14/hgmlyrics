// tests/metronome.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clampBpm,
  tapBpmFromIntervals,
  TIME_SIGNATURES,
  BPM_MIN,
  BPM_MAX,
  DEFAULT_BPM,
} from '../src/lib/metronome.js';

describe('clampBpm', () => {
  it('mantiene un BPM dentro de rango', () => {
    expect(clampBpm(120)).toBe(120);
  });
  it('recorta por debajo del mínimo y por encima del máximo', () => {
    expect(clampBpm(10)).toBe(BPM_MIN);
    expect(clampBpm(999)).toBe(BPM_MAX);
  });
  it('redondea decimales y cae al default ante valores no finitos', () => {
    expect(clampBpm(119.6)).toBe(120);
    expect(clampBpm(Number.NaN)).toBe(DEFAULT_BPM);
    expect(clampBpm('abc')).toBe(DEFAULT_BPM);
  });
});

describe('tapBpmFromIntervals', () => {
  it('devuelve null sin intervalos', () => {
    expect(tapBpmFromIntervals([])).toBeNull();
  });
  it('calcula BPM desde intervalos regulares (500ms → 120)', () => {
    expect(tapBpmFromIntervals([500, 500, 500])).toBe(120);
  });
  it('rechaza outliers usando la mediana', () => {
    expect(tapBpmFromIntervals([500, 500, 500, 1500])).toBe(120);
  });
});

describe('TIME_SIGNATURES', () => {
  it('define beats y acentos para cada compás soportado', () => {
    expect(TIME_SIGNATURES['4/4']).toEqual({ beats: 4, accents: [0] });
    expect(TIME_SIGNATURES['3/4']).toEqual({ beats: 3, accents: [0] });
    expect(TIME_SIGNATURES['2/4']).toEqual({ beats: 2, accents: [0] });
    expect(TIME_SIGNATURES['6/8']).toEqual({ beats: 6, accents: [0, 3] });
  });
});
