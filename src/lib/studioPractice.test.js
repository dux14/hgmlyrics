import { describe, it, expect } from 'vitest';
import {
  isTrackAudible,
  nowSoundLabel,
  lineSegmentIndex,
  loopSeekTarget,
} from './studioPractice.js';

describe('isTrackAudible (modelo C: aditivo + aislar)', () => {
  it('sin solos: audible = habilitada', () => {
    expect(isTrackAudible({ i: 0, disabled: new Set(), soloed: new Set() })).toBe(true);
    expect(isTrackAudible({ i: 0, disabled: new Set([0]), soloed: new Set() })).toBe(false);
  });
  it('con solo activo: solo suenan las soleadas, ignorando disabled', () => {
    expect(isTrackAudible({ i: 1, disabled: new Set([1]), soloed: new Set([1]) })).toBe(true);
    expect(isTrackAudible({ i: 0, disabled: new Set(), soloed: new Set([1]) })).toBe(false);
  });
});

describe('nowSoundLabel', () => {
  const tracks = [{ label: 'Voz principal' }, { label: 'Guitarra' }, { label: 'Coros' }];
  it('lista las habilitadas', () => {
    expect(nowSoundLabel(tracks, new Set([2]), new Set())).toBe(
      'Sonando: Voz principal + Guitarra',
    );
  });
  it('con solo: solo las aisladas', () => {
    expect(nowSoundLabel(tracks, new Set(), new Set([1]))).toBe('Sonando: Guitarra');
  });
  it('todo apagado', () => {
    expect(nowSoundLabel(tracks, new Set([0, 1, 2]), new Set())).toBe('Nada sonando');
  });
});

describe('lineSegmentIndex (solape temporal, mismo criterio que assignStructureSegment)', () => {
  const segments = [
    { label: 'verso', startMs: 0, endMs: 30000 },
    { label: 'coro', startMs: 30000, endMs: 60000 },
  ];
  it('asigna por el inicio de la línea (segundos) dentro de [startMs, endMs)', () => {
    expect(lineSegmentIndex(1.2, segments)).toBe(0);
    expect(lineSegmentIndex(30.0, segments)).toBe(1);
  });
  it('fuera de todo segmento: -1', () => {
    expect(lineSegmentIndex(120, segments)).toBe(-1);
    expect(lineSegmentIndex(5, [])).toBe(-1);
  });
});

describe('loopSeekTarget', () => {
  const seg = { startMs: 30000, endMs: 60000 };
  it('al llegar al fin del segmento vuelve al inicio', () => {
    expect(loopSeekTarget(60.01, seg)).toBe(30);
    expect(loopSeekTarget(59.9, seg)).toBe(null);
  });
  it('sin loop activo: null', () => {
    expect(loopSeekTarget(60.01, null)).toBe(null);
  });
});
