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

import { createMetronome } from '../src/lib/metronome.js';

// Nodo de audio falso: connect(next) devuelve next para soportar el encadenado
// osc.connect(gain).connect(destination).
function makeMockAudio() {
  let t = 0;
  function node() {
    return {
      type: '',
      frequency: { value: 0 },
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn((next) => next),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  const ctx = {
    state: 'running',
    destination: {},
    createOscillator: vi.fn(() => node()),
    createGain: vi.fn(() => node()),
    resume: vi.fn(),
    close: vi.fn(),
    get currentTime() {
      return t;
    },
  };
  const AudioContextClass = vi.fn(() => ctx);
  const setTime = (v) => {
    t = v;
  };
  return { AudioContextClass, ctx, setTime };
}

describe('createMetronome — estado y BPM', () => {
  it('arranca con defaults y recorta setBpm a rango', () => {
    const { AudioContextClass } = makeMockAudio();
    const m = createMetronome({ AudioContextClass });
    expect(m.getBpm()).toBe(120);
    expect(m.getSignature()).toBe('4/4');
    expect(m.setBpm(10)).toBe(40);
    expect(m.setBpm(999)).toBe(240);
    expect(m.getBpm()).toBe(240);
  });

  it('setSignature acepta compases válidos e ignora inválidos', () => {
    const { AudioContextClass } = makeMockAudio();
    const m = createMetronome({ AudioContextClass });
    expect(m.setSignature('3/4')).toBe('3/4');
    expect(m.setSignature('7/16')).toBe('3/4');
  });

  it('no crea el AudioContext hasta arrancar', () => {
    const { AudioContextClass } = makeMockAudio();
    createMetronome({ AudioContextClass });
    expect(AudioContextClass).not.toHaveBeenCalled();
  });
});

describe('createMetronome — tap tempo', () => {
  it('necesita ≥2 taps; calcula y aplica el BPM', () => {
    const { AudioContextClass } = makeMockAudio();
    let fakeNow = 0;
    const m = createMetronome({ AudioContextClass, now: () => fakeNow });
    expect(m.tap()).toBeNull();
    fakeNow = 500;
    expect(m.tap()).toBe(120);
    fakeNow = 1000;
    expect(m.tap()).toBe(120);
    expect(m.getBpm()).toBe(120);
  });

  it('resetea el buffer si el gap supera 2s', () => {
    const { AudioContextClass } = makeMockAudio();
    let fakeNow = 0;
    const m = createMetronome({ AudioContextClass, now: () => fakeNow });
    m.tap();
    fakeNow = 500;
    expect(m.tap()).toBe(120);
    fakeNow = 3000;
    expect(m.tap()).toBeNull();
  });
});

describe('createMetronome — scheduler y ciclo de vida', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('agenda la secuencia de beats con el patrón de acento de 4/4', () => {
    const { AudioContextClass, setTime } = makeMockAudio();
    const beats = [];
    const m = createMetronome({
      AudioContextClass,
      useWorker: false,
      lookahead: 25,
      scheduleAheadTime: 0.1,
      onBeat: (beat, accent) => beats.push({ beat, accent }),
    });
    m.setBpm(120);
    m.start();
    setTime(0.45);
    vi.advanceTimersByTime(25);
    setTime(0.95);
    vi.advanceTimersByTime(25);
    setTime(1.45);
    vi.advanceTimersByTime(25);
    setTime(1.95);
    vi.advanceTimersByTime(25);
    expect(beats.map((b) => b.beat)).toEqual([0, 1, 2, 3, 0]);
    expect(beats.map((b) => b.accent)).toEqual([true, false, false, false, true]);
    m.dispose();
  });

  it('start() es idempotente y stop() no lanza si no corre', () => {
    const { AudioContextClass } = makeMockAudio();
    const beats = [];
    const m = createMetronome({
      AudioContextClass,
      useWorker: false,
      onBeat: () => beats.push(1),
    });
    m.start();
    const after1 = beats.length;
    m.start();
    expect(beats.length).toBe(after1);
    expect(() => m.stop()).not.toThrow();
    expect(() => m.stop()).not.toThrow();
    m.dispose();
  });

  it('dispose() detiene el ticker: no se agendan más beats', () => {
    const { AudioContextClass, setTime } = makeMockAudio();
    const beats = [];
    const m = createMetronome({
      AudioContextClass,
      useWorker: false,
      lookahead: 25,
      scheduleAheadTime: 0.1,
      onBeat: () => beats.push(1),
    });
    m.start();
    m.dispose();
    const frozen = beats.length;
    setTime(5);
    vi.advanceTimersByTime(200);
    expect(beats.length).toBe(frozen);
  });
});
