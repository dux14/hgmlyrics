/**
 * pitchDetector.test.js — Smoke + error-path tests del controller.
 * No testea el lifecycle de audio (AudioContext no está en jsdom);
 * la verificación real es manual en browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPitchDetector } from '../src/lib/pitch.js';

describe('createPitchDetector — debug shape', () => {
  it('getDebugState() before start() returns null-shaped object', () => {
    const d = createPitchDetector({ onPitch: () => {} });
    const s = d.getDebugState();
    expect(s.ctxState).toBeNull();
    expect(s.sampleRate).toBeNull();
    expect(s.streamActive).toBeNull();
    expect(s.track).toBeNull();
    expect(s.lastRms).toBeNull();
    expect(s.lastHz).toBeNull();
    expect(s.events).toEqual([]);
  });

  it('isRunning() is false on a fresh detector', () => {
    const d = createPitchDetector({ onPitch: () => {} });
    expect(d.isRunning()).toBe(false);
  });
});

describe('createPitchDetector — getUserMedia error path', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('permission denied')),
      },
    });
  });

  it('emits [getUserMedia] error and transitions to denied', async () => {
    const errors = [];
    const states = [];
    const events = [];
    const d = createPitchDetector({
      onPitch: () => {},
      onError: (e) => errors.push(e.message),
      onState: (s) => states.push(s),
      onEvent: (e) => events.push(e),
    });
    await d.start();
    expect(states).toContain('requesting');
    expect(states).toContain('denied');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('[getUserMedia]');
    expect(errors[0]).toContain('permission denied');
    expect(events.some((e) => e.type === 'gum-call')).toBe(true);
    expect(events.some((e) => e.type === 'error' && e.data.step === 'getUserMedia')).toBe(true);
    expect(d.isRunning()).toBe(false);
  });
});
