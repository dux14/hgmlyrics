import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBeatClock } from './beatClock.js';
import { createMetronomeClick } from './metronomeClick.js';

const grid = {
  beatsMs: [1000, 1650, 2300, 2950, 3600, 4250, 4900, 5550],
  timeSignature: '4/4',
  beatAnchor: 1,
};

/** Oscillator/gain fake mínimos, solo lo que toca metronomeClick.js. */
function makeFakeNode(extra = {}) {
  return {
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: { value: 0, setValueAtTime: vi.fn() },
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    ...extra,
  };
}

function makeFakeAudioContext() {
  const oscillators = [];
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createOscillator: vi.fn(() => {
      const osc = makeFakeNode();
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => makeFakeNode()),
    close: vi.fn(),
  };
  return { ctx, oscillators };
}

describe('createMetronomeClick', () => {
  let clock;
  let nowMs;
  let getTimeMs;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = createBeatClock(grid);
    nowMs = 0;
    getTimeMs = () => nowMs;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('muteado por default no crea contexto ni programa clicks', () => {
    const createContext = vi.fn();
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    expect(m.isMuted()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(createContext).not.toHaveBeenCalled();
  });

  it('des-mutear crea el contexto lazy y programa el próximo beat con acento en el 1', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 900; // próximo beat: 1000ms, beatInBar 1
    const m = createMetronomeClick({ clock, getTimeMs, createContext });

    m.setMuted(false);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(m.isMuted()).toBe(false);

    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(1);
    expect(oscillators[0].frequency.value).toBe(1320); // acento
    expect(oscillators[0].start).toHaveBeenCalledTimes(1);
  });

  it('no acentuado usa 880 Hz para beats fuera del 1', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 1550; // próximo beat: 1650ms, beatInBar 2
    const m = createMetronomeClick({ clock, getTimeMs, createContext });

    m.setMuted(false);
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(1);
    expect(oscillators[0].frequency.value).toBe(880);
  });

  it('no programa el mismo beat dos veces al avanzar varios ticks', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 900;
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    m.setMuted(false);

    // Varios ticks de 25ms sin mover nowMs: el mismo beat cae repetidas veces
    // en la ventana pero no debe re-agendarse.
    vi.advanceTimersByTime(25);
    vi.advanceTimersByTime(25);
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(1);
  });

  it('agenda múltiples beats a medida que el tiempo avanza', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 900;
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    m.setMuted(false);

    vi.advanceTimersByTime(25); // agenda beat en 1000
    expect(oscillators.length).toBe(1);

    nowMs = 1600; // ventana llega hasta 1720: agenda beat en 1650
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(2);
    expect(oscillators[1].frequency.value).toBe(880);
  });

  it('setMuted(true) detiene el interval y no agenda más clicks', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 900;
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    m.setMuted(false);
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(1);

    m.setMuted(true);
    expect(m.isMuted()).toBe(true);
    nowMs = 1600;
    vi.advanceTimersByTime(200);
    expect(oscillators.length).toBe(1); // no crecio: el interval esta detenido
  });

  it('des-mutear de nuevo tras mute reanuda sin re-disparar el beat ya sonado', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 900;
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    m.setMuted(false);
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(1);

    m.setMuted(true);
    nowMs = 1600;
    m.setMuted(false);
    expect(createContext).toHaveBeenCalledTimes(1); // contexto ya existía, no se recrea
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(2); // solo el beat en 1650, no el de 1000 de nuevo
  });

  it('stop() cancela el interval y cierra el contexto sin errores', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 900;
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    m.setMuted(false);
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(1);

    expect(() => m.stop()).not.toThrow();
    expect(ctx.close).toHaveBeenCalledTimes(1);

    nowMs = 1600;
    vi.advanceTimersByTime(200);
    expect(oscillators.length).toBe(1); // stop detuvo el scheduler
  });

  it('stop() sin haber des-muteado nunca no explota (sin contexto que cerrar)', () => {
    const createContext = vi.fn();
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    expect(() => m.stop()).not.toThrow();
    expect(createContext).not.toHaveBeenCalled();
  });

  it('stop() no explota si ctx.close() lanza (contexto ya cerrado)', () => {
    const { ctx } = makeFakeAudioContext();
    ctx.close = vi.fn(() => {
      throw new Error('already closed');
    });
    const createContext = vi.fn(() => ctx);
    nowMs = 900;
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    m.setMuted(false);
    vi.advanceTimersByTime(25);

    expect(() => m.stop()).not.toThrow();
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('des-mutear resume el contexto si quedó suspendido (autoplay policy)', () => {
    const { ctx } = makeFakeAudioContext();
    ctx.state = 'suspended';
    ctx.resume = vi.fn();
    const createContext = vi.fn(() => ctx);
    nowMs = 900;
    const m = createMetronomeClick({ clock, getTimeMs, createContext });

    m.setMuted(false);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('seek hacia atrás resetea lastScheduled y vuelve a agendar beats en la posición anterior', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 900;
    const m = createMetronomeClick({ clock, getTimeMs, createContext });
    m.setMuted(false);

    vi.advanceTimersByTime(25); // agenda beat en 1000
    nowMs = 2900; // avanza lejos: próximo beat 2950 entra en la ventana
    vi.advanceTimersByTime(25);
    const scheduledBeforeSeek = oscillators.length;
    expect(scheduledBeforeSeek).toBeGreaterThan(1);

    // El usuario mueve el scrubber hacia atrás, mucho antes del último beat agendado.
    nowMs = 900;
    vi.advanceTimersByTime(25);

    // Vuelve a agendarse el beat en 1000 (ya no está bloqueado por un
    // lastScheduled que quedó en el futuro).
    expect(oscillators.length).toBeGreaterThan(scheduledBeforeSeek);
  });

  it('agenda un beat exactamente en el borde now+120ms', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 1530; // 1650 - 1530 = 120ms exactos: dentro de la ventana
    const m = createMetronomeClick({ clock, getTimeMs, createContext });

    m.setMuted(false);
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(1);
  });

  it('no agenda un beat en now+121ms hasta que el siguiente tick lo alcance', () => {
    const { ctx, oscillators } = makeFakeAudioContext();
    const createContext = vi.fn(() => ctx);
    nowMs = 1529; // 1650 - 1529 = 121ms: justo fuera de la ventana
    const m = createMetronomeClick({ clock, getTimeMs, createContext });

    m.setMuted(false);
    vi.advanceTimersByTime(25);
    expect(oscillators.length).toBe(0);
  });
});
