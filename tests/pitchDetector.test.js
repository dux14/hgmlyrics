import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPitchDetector } from '../src/lib/pitch.js';

function fakeAudio({ withWorklet }) {
  const node = {
    port: { onmessage: null, postMessage: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    getFloatTimeDomainData: vi.fn(),
  };
  const ctx = {
    state: 'running',
    sampleRate: 44100,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
  };
  if (withWorklet) {
    ctx.audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    globalThis.AudioWorkletNode = vi.fn(function () {
      return node;
    });
  } else {
    globalThis.AudioWorkletNode = undefined;
  }
  window.AudioContext = vi.fn(function () {
    return ctx;
  });
  navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  };
  return { ctx, node, analyser };
}

beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
});
afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.AudioWorkletNode;
});

describe('createPitchDetector — camino AudioWorklet', () => {
  it('carga el módulo, crea el AudioWorkletNode y enruta port.onmessage a onPitch', async () => {
    const { ctx, node, analyser } = fakeAudio({ withWorklet: true });
    const onPitch = vi.fn();
    const det = createPitchDetector({ onPitch });
    await det.start();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalled();
    expect(globalThis.AudioWorkletNode).toHaveBeenCalledWith(
      ctx,
      'yin-processor',
      expect.any(Object),
    );
    expect(analyser.getFloatTimeDomainData).not.toHaveBeenCalled(); // no usó el fallback
    // Simula un mensaje del worklet:
    node.port.onmessage({ data: { hz: 440, rms: 0.2 } });
    expect(onPitch).toHaveBeenCalledWith({ hz: 440, rms: 0.2 });
    det.stop();
  });
});

describe('createPitchDetector — fallback AnalyserNode', () => {
  it('si no hay AudioWorklet, usa createAnalyser', async () => {
    const { ctx } = fakeAudio({ withWorklet: false });
    const det = createPitchDetector({ onPitch: vi.fn() });
    await det.start();
    expect(ctx.createAnalyser).toHaveBeenCalled();
    det.stop();
  });
});
