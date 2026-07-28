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
  const highpass = {
    type: '',
    frequency: { value: 0 },
    Q: { value: 0 },
    connect: vi.fn(),
  };
  const source = { connect: vi.fn() };
  const ctx = {
    state: 'running',
    sampleRate: 44100,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    createBiquadFilter: vi.fn(() => highpass),
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
  // Track real (extiende EventTarget) para poder disparar 'ended' desde los
  // tests y controlar readyState/muted, igual que un MediaStreamTrack real.
  const tracks = [];
  function makeTrack() {
    const track = Object.assign(new globalThis.EventTarget(), {
      readyState: 'live',
      muted: false,
      stop: vi.fn(),
      getSettings: vi.fn(() => ({ autoGainControl: false, channelCount: 1 })),
    });
    tracks.push(track);
    return track;
  }
  const getUserMedia = vi.fn().mockImplementation(() => {
    const track = makeTrack();
    return Promise.resolve({
      getTracks: () => [track],
      getAudioTracks: () => [track],
    });
  });
  navigator.mediaDevices = { getUserMedia };
  return { ctx, node, analyser, highpass, source, getUserMedia, tracks };
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

  it('emite hz/rms/confidence con el mismo shape que el worklet', async () => {
    const { ctx, analyser } = fakeAudio({ withWorklet: false });
    // Seno de 440Hz para que detectPitchDetailed devuelva un candidato real.
    analyser.getFloatTimeDomainData.mockImplementation((buf) => {
      for (let i = 0; i < buf.length; i++) {
        buf[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / ctx.sampleRate);
      }
    });
    const onPitch = vi.fn();
    // Ejecuta un unico tick sincronico; los rAF posteriores quedan en no-op
    // (igual que el beforeEach) para no recursar infinitamente.
    let firstTick = true;
    globalThis.requestAnimationFrame = (cb) => {
      if (firstTick) {
        firstTick = false;
        cb();
      }
      return 0;
    };
    const det = createPitchDetector({ onPitch, fftSize: 2048 });
    await det.start();
    expect(onPitch).toHaveBeenCalled();
    const payload = onPitch.mock.calls[0][0];
    expect(payload).toHaveProperty('hz');
    expect(payload).toHaveProperty('rms');
    expect(typeof payload.confidence).toBe('number');
    det.stop();
  });
});

describe('createPitchDetector — constraints de getUserMedia', () => {
  it('pide autoGainControl false y channelCount 1 (ademas de EC/NS false)', async () => {
    const { getUserMedia } = fakeAudio({ withWorklet: false });
    const det = createPitchDetector({ onPitch: vi.fn() });
    await det.start();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      }),
    });
    det.stop();
  });
});

describe('createPitchDetector — high-pass', () => {
  it('inserta un BiquadFilterNode highpass a 75Hz entre source y analyser (camino fallback)', async () => {
    const { ctx, source, highpass, analyser } = fakeAudio({ withWorklet: false });
    const det = createPitchDetector({ onPitch: vi.fn() });
    await det.start();
    expect(ctx.createBiquadFilter).toHaveBeenCalled();
    expect(highpass.type).toBe('highpass');
    expect(highpass.frequency.value).toBe(75);
    expect(highpass.Q.value).toBeCloseTo(0.707);
    expect(source.connect).toHaveBeenCalledWith(highpass);
    expect(highpass.connect).toHaveBeenCalledWith(analyser);
    det.stop();
  });
});

describe('createPitchDetector — recuperación tras background/foreground', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('el track "ended" con página visible relanza getUserMedia y vuelve a emitir "running"', async () => {
    const { getUserMedia, tracks } = fakeAudio({ withWorklet: false });
    const states = [];
    const det = createPitchDetector({ onPitch: vi.fn(), onState: (s) => states.push(s) });
    await det.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('running');

    tracks[0].dispatchEvent(new Event('ended'));

    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(states.at(-1)).toBe('running');
    // No debió emitir 'stopped' en el medio de la recuperación.
    expect(states).not.toContain('stopped');

    det.stop();
  });

  it('el track "ended" con página oculta solo marca needsRecovery (no relanza getUserMedia aún)', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const { getUserMedia, tracks } = fakeAudio({ withWorklet: false });
    const det = createPitchDetector({ onPitch: vi.fn() });
    await det.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    tracks[0].dispatchEvent(new Event('ended'));
    // Todavía oculta: no debe relanzar getUserMedia de inmediato.
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    det.stop();
  });

  it('visibilitychange a visible con ctx suspendido llama a ctx.resume()', async () => {
    const { ctx } = fakeAudio({ withWorklet: false });
    const det = createPitchDetector({ onPitch: vi.fn() });
    await det.start();
    ctx.state = 'suspended';

    document.dispatchEvent(new Event('visibilitychange'));

    expect(ctx.resume).toHaveBeenCalled();
    det.stop();
  });

  it('tras la gracia de 300ms, un track muted en visibilitychange dispara recover()', async () => {
    vi.useFakeTimers();
    try {
      const { getUserMedia, tracks } = fakeAudio({ withWorklet: false });
      const det = createPitchDetector({ onPitch: vi.fn() });
      await det.start();
      expect(getUserMedia).toHaveBeenCalledTimes(1);

      tracks[0].muted = true;
      document.dispatchEvent(new Event('visibilitychange'));
      // Antes de la gracia, no debe recuperar todavía.
      expect(getUserMedia).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(300);
      expect(getUserMedia).toHaveBeenCalledTimes(2);

      det.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tras stop(), visibilitychange y "ended" no relanzan getUserMedia ni emiten estados', async () => {
    const { getUserMedia, tracks } = fakeAudio({ withWorklet: false });
    const states = [];
    const det = createPitchDetector({ onPitch: vi.fn(), onState: (s) => states.push(s) });
    await det.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const track = tracks[0];

    det.stop();
    states.length = 0;

    document.dispatchEvent(new Event('visibilitychange'));
    track.dispatchEvent(new Event('ended'));

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(states).toEqual([]);
  });
});
