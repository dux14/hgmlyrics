import { describe, it, expect } from 'vitest';
import {
  isTrackAudible,
  nowSoundLabel,
  lineSegmentIndex,
  loopSeekTarget,
  defaultActiveSet,
  toggleTrack,
  layerOf,
  TRACK_LAYERS,
} from './studioPractice.js';

// Los 13 kinds que publica el separador para una canción completa.
const FULL = [
  'vocals',
  'lead',
  'backing',
  'male',
  'female',
  'voice_a',
  'voice_b',
  'instrumental',
  'drums',
  'bass',
  'guitar',
  'piano',
  'other',
].map((kind) => ({ kind, label: kind }));

const kindsOf = (tracks, active) => [...active].sort((a, b) => a - b).map((i) => tracks[i].kind);

describe('capas del mixer (particiones excluyentes)', () => {
  it('layerOf ubica cada kind en su dominio y partición', () => {
    expect(layerOf('vocals')).toEqual({ domain: 'voces', layer: 0 });
    expect(layerOf('lead')).toEqual({ domain: 'voces', layer: 1 });
    expect(layerOf('male')).toEqual({ domain: 'voces', layer: 2 });
    expect(layerOf('drums')).toEqual({ domain: 'instrumentos', layer: 1 });
    expect(layerOf('kazoo')).toBe(null);
  });

  it('arranca en la mezcla original: solo vocals + instrumental', () => {
    expect(kindsOf(FULL, defaultActiveSet(FULL))).toEqual(['vocals', 'instrumental']);
  });

  it('sin la partición completa de un dominio, cae a la siguiente disponible', () => {
    const tracks = [{ kind: 'lead' }, { kind: 'backing' }, { kind: 'drums' }, { kind: 'bass' }];
    expect(kindsOf(tracks, defaultActiveSet(tracks))).toEqual(['lead', 'backing', 'drums', 'bass']);
  });

  it('un kind desconocido nunca queda inaudible', () => {
    const tracks = [{ kind: 'vocals' }, { kind: 'kazoo' }];
    expect(kindsOf(tracks, defaultActiveSet(tracks))).toEqual(['vocals', 'kazoo']);
  });

  it('encender lead expulsa a vocals y al resto de particiones vocales', () => {
    const start = defaultActiveSet(FULL);
    const next = toggleTrack(start, 1, FULL); // lead
    expect(kindsOf(FULL, next)).toEqual(['lead', 'instrumental']);
  });

  it('dentro de la misma partición el mixer sigue siendo aditivo', () => {
    let s = defaultActiveSet(FULL);
    s = toggleTrack(s, 1, FULL); // lead
    s = toggleTrack(s, 2, FULL); // backing (misma partición)
    expect(kindsOf(FULL, s)).toEqual(['lead', 'backing', 'instrumental']);
  });

  it('encender un instrumento expulsa a instrumental sin tocar las voces', () => {
    let s = defaultActiveSet(FULL);
    s = toggleTrack(s, 8, FULL); // drums
    expect(kindsOf(FULL, s)).toEqual(['vocals', 'drums']);
  });

  it('apagar una pista no enciende ni apaga ninguna otra', () => {
    let s = defaultActiveSet(FULL);
    s = toggleTrack(s, 0, FULL); // apaga vocals
    expect(kindsOf(FULL, s)).toEqual(['instrumental']);
  });

  // Propiedad que evita el bug original: la señal nunca suena duplicada.
  it('ninguna secuencia de toggles deja dos particiones del mismo dominio activas', () => {
    let s = defaultActiveSet(FULL);
    for (const i of [3, 5, 1, 9, 0, 7, 4, 11, 2, 6]) {
      s = toggleTrack(s, i, FULL);
      for (const domain of Object.keys(TRACK_LAYERS)) {
        const layers = new Set(
          [...s]
            .map((j) => layerOf(FULL[j].kind))
            .filter((l) => l?.domain === domain)
            .map((l) => l.layer),
        );
        expect(layers.size).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('isTrackAudible (aditivo dentro de la capa + aislar)', () => {
  it('sin solos: audible = activa', () => {
    expect(isTrackAudible({ i: 0, active: new Set([0]), soloed: new Set() })).toBe(true);
    expect(isTrackAudible({ i: 0, active: new Set(), soloed: new Set() })).toBe(false);
  });
  it('con solo activo: solo suenan las aisladas, ignorando la mezcla', () => {
    expect(isTrackAudible({ i: 1, active: new Set(), soloed: new Set([1]) })).toBe(true);
    expect(isTrackAudible({ i: 0, active: new Set([0]), soloed: new Set([1]) })).toBe(false);
  });
});

describe('nowSoundLabel', () => {
  const tracks = [{ label: 'Voz principal' }, { label: 'Guitarra' }, { label: 'Coros' }];
  it('lista las activas', () => {
    expect(nowSoundLabel(tracks, new Set([0, 1]), new Set())).toBe(
      'Sonando: Voz principal + Guitarra',
    );
  });
  it('con solo: solo las aisladas', () => {
    expect(nowSoundLabel(tracks, new Set([0, 1, 2]), new Set([1]))).toBe('Sonando: Guitarra');
  });
  it('todo apagado', () => {
    expect(nowSoundLabel(tracks, new Set(), new Set())).toBe('Nada sonando');
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
