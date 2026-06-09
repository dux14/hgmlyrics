// tests/tonePlayer.test.js
import { describe, it, expect, vi } from 'vitest';
import { createTonePlayer } from '../src/lib/tonePlayer.js';

function makeMockAudio() {
  const osc = {
    type: '',
    frequency: { value: 0 },
    connect: vi.fn(() => gain),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(() => ctx.destination),
    disconnect: vi.fn(),
  };
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    resume: vi.fn(),
    close: vi.fn(),
  };
  const AudioContextClass = vi.fn(() => ctx);
  return { AudioContextClass, ctx, osc, gain };
}

describe('createTonePlayer', () => {
  it('play() configura un oscilador sine a la frecuencia pedida y lo conecta', () => {
    const m = makeMockAudio();
    const player = createTonePlayer({ AudioContextClass: m.AudioContextClass });
    player.play(440, 800);
    expect(m.osc.type).toBe('sine');
    expect(m.osc.frequency.value).toBe(440);
    expect(m.osc.connect).toHaveBeenCalledWith(m.gain);
    expect(m.gain.connect).toHaveBeenCalledWith(m.ctx.destination);
    expect(m.osc.start).toHaveBeenCalled();
    expect(m.osc.stop).toHaveBeenCalled();
  });

  it('crea el AudioContext perezosamente (no en el constructor)', () => {
    const m = makeMockAudio();
    createTonePlayer({ AudioContextClass: m.AudioContextClass });
    expect(m.AudioContextClass).not.toHaveBeenCalled();
  });

  it('stop() detiene un oscilador en curso sin lanzar', () => {
    const m = makeMockAudio();
    const player = createTonePlayer({ AudioContextClass: m.AudioContextClass });
    player.play(440);
    expect(() => player.stop()).not.toThrow();
    expect(m.osc.disconnect).toHaveBeenCalled();
  });

  it('close() cierra el AudioContext', () => {
    const m = makeMockAudio();
    const player = createTonePlayer({ AudioContextClass: m.AudioContextClass });
    player.play(440);
    player.close();
    expect(m.ctx.close).toHaveBeenCalled();
  });
});
