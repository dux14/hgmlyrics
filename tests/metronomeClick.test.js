// tests/metronomeClick.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMetronomeClick } from '../src/lib/metronomeClick.js';

// Mock de AudioContext: listener registry propio para 'statechange' (evita
// depender de EventTarget global) + state mutable + resume() espiable. El
// clock inyectado no agenda beats (msToNextBeat: null), asi que no hace falta
// stubear oscillator/gain para que scheduleBeat corra.
function makeMockContext({ resumeImpl } = {}) {
  const listeners = new Set();
  const ctx = {
    state: 'running',
    currentTime: 0,
    resume: vi.fn(resumeImpl || (() => Promise.resolve())),
    close: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(),
    createGain: vi.fn(),
    destination: {},
    addEventListener: (type, listener) => {
      if (type === 'statechange') listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === 'statechange') listeners.delete(listener);
    },
    dispatchStateChange: () => {
      for (const listener of listeners) listener();
    },
  };
  return ctx;
}

function makeNullClock() {
  return { at: vi.fn(() => ({ msToNextBeat: null, beatInBar: 1 })) };
}

describe('createMetronomeClick — resiliencia del AudioContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('desmuteado: statechange a suspended dispara resume()', () => {
    const ctx = makeMockContext();
    const click = createMetronomeClick({
      clock: makeNullClock(),
      getTimeMs: () => 0,
      createContext: () => ctx,
    });

    click.setMuted(false);
    ctx.resume.mockClear();
    ctx.state = 'suspended';
    ctx.dispatchStateChange();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('muteado: statechange a suspended NO dispara resume()', () => {
    const ctx = makeMockContext();
    const click = createMetronomeClick({
      clock: makeNullClock(),
      getTimeMs: () => 0,
      createContext: () => ctx,
    });

    // Crea el ctx (lazy) desmuteando, luego vuelve a mutear.
    click.setMuted(false);
    click.setMuted(true);
    ctx.resume.mockClear();
    ctx.state = 'suspended';
    ctx.dispatchStateChange();

    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('en cada tick, si el ctx no esta running y esta desmuteado, llama resume() best-effort', () => {
    const ctx = makeMockContext();
    const click = createMetronomeClick({
      clock: makeNullClock(),
      getTimeMs: () => 0,
      createContext: () => ctx,
    });

    click.setMuted(false);
    ctx.resume.mockClear();
    ctx.state = 'suspended';

    vi.advanceTimersByTime(25);

    expect(ctx.resume).toHaveBeenCalled();
  });

  it('en tick, si resume() rechaza, no propaga la excepcion', () => {
    const ctx = makeMockContext({ resumeImpl: () => Promise.reject(new Error('nope')) });
    const click = createMetronomeClick({
      clock: makeNullClock(),
      getTimeMs: () => 0,
      createContext: () => ctx,
    });

    click.setMuted(false);
    ctx.state = 'suspended';

    expect(() => vi.advanceTimersByTime(25)).not.toThrow();
  });

  it('stop() remueve el listener statechange: tras stop(), un statechange no vuelve a llamar resume()', () => {
    const ctx = makeMockContext();
    const click = createMetronomeClick({
      clock: makeNullClock(),
      getTimeMs: () => 0,
      createContext: () => ctx,
    });

    click.setMuted(false);
    click.stop();
    ctx.resume.mockClear();
    ctx.state = 'suspended';
    ctx.dispatchStateChange();

    expect(ctx.resume).not.toHaveBeenCalled();
  });
});
