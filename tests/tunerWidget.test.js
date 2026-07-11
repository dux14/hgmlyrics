import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub pitch detector (requires AudioContext/getUserMedia) — mismo patrón que tuner.test.js.
const onPitchRef = { current: null };
const onStateRef = { current: null };
const onErrorRef = { current: null };
// start() por defecto resuelve de inmediato (contrato real de pitch.js: Promise<void>);
// los tests de carrera lo sobrescriben con mockImplementationOnce para controlarlo a mano.
const detectorStart = vi.fn(() => Promise.resolve());
const detectorStop = vi.fn();

vi.mock('../src/lib/pitch.js', () => ({
  createPitchDetector: vi.fn((opts) => {
    onPitchRef.current = opts.onPitch;
    onStateRef.current = opts.onState;
    onErrorRef.current = opts.onError;
    return { start: detectorStart, stop: detectorStop, isRunning: () => false };
  }),
}));

const { createTunerEngine, colorFromCents } = await import('../src/lib/tunerWidget.js');
const { createPitchDetector } = await import('../src/lib/pitch.js');

beforeEach(() => {
  localStorage.clear();
  detectorStart.mockClear();
  detectorStop.mockClear();
  createPitchDetector.mockClear();
  onPitchRef.current = null;
  onStateRef.current = null;
  onErrorRef.current = null;
});

describe('createTunerEngine — motor puro (sin DOM)', () => {
  it('expone start/stop/isRunning', () => {
    const engine = createTunerEngine({ onPitch: vi.fn(), onState: vi.fn() });
    expect(engine.isRunning()).toBe(false);
    engine.start();
    expect(engine.isRunning()).toBe(true);
    expect(detectorStart).toHaveBeenCalledTimes(1);
    engine.stop();
    expect(engine.isRunning()).toBe(false);
    expect(detectorStop).toHaveBeenCalledTimes(1);
  });

  it('entrega pitch estabilizado a onPitch', () => {
    const onPitch = vi.fn();
    const engine = createTunerEngine({ onPitch, onState: vi.fn() });
    engine.start();
    onPitchRef.current({ hz: 440, rms: 0.2, confidence: 1 });
    expect(onPitch).toHaveBeenCalledTimes(1);
    expect(onPitch.mock.calls[0][0]).toMatchObject({ note: 'A', octave: 4, midi: 69 });
  });

  it('ignora callbacks de un detector obsoleto (epoca vieja tras stop+start)', () => {
    const onPitch = vi.fn();
    const onState = vi.fn();
    const engine = createTunerEngine({ onPitch, onState });

    engine.start();
    const oldOnPitch = onPitchRef.current;
    const oldOnState = onStateRef.current;
    engine.stop();
    engine.start();
    expect(createPitchDetector).toHaveBeenCalledTimes(2);

    onPitch.mockClear();
    onState.mockClear();
    oldOnPitch({ hz: 440, rms: 0.2, confidence: 1 });
    oldOnState('running');
    expect(onPitch).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
  });

  it('stop() resetea el estabilizador: la nota nueva no arrastra histeresis previa', () => {
    const onPitch = vi.fn();
    const engine = createTunerEngine({ onPitch, onState: vi.fn() });
    engine.start();
    onPitchRef.current({ hz: 440, rms: 0.2, confidence: 1 }); // fija A4

    engine.stop();
    onPitch.mockClear();
    engine.start();
    onPitchRef.current({ hz: 523.25, rms: 0.2, confidence: 1 }); // C5
    expect(onPitch.mock.calls[0][0]).toMatchObject({ note: 'C', octave: 5 });
  });

  it('stop() notifica el estado "idle" via onState', () => {
    const onState = vi.fn();
    const engine = createTunerEngine({ onPitch: vi.fn(), onState });
    engine.start();
    engine.stop();
    expect(onState).toHaveBeenCalledWith('idle');
  });

  it('requestMic() tras "denied" crea un detector nuevo (reintento no queda pegado)', async () => {
    const engine = createTunerEngine({ onPitch: vi.fn(), onState: vi.fn() });
    engine.start();
    expect(createPitchDetector).toHaveBeenCalledTimes(1);
    onStateRef.current('denied'); // getUserMedia rechazado (permiso denegado)
    // El nuleo de la epoca es diferido a un microtask (ver onState() en
    // requestMic()): un click de reintento real nunca ocurre en el mismo
    // tick que el evento del navegador, así que el test tampoco lo hace.
    await Promise.resolve();
    engine.requestMic();
    expect(createPitchDetector).toHaveBeenCalledTimes(2);
  });

  it('requestMic() tras "stopped" (recover() fallido en background) tambien permite reintentar', async () => {
    const engine = createTunerEngine({ onPitch: vi.fn(), onState: vi.fn() });
    engine.start();
    onStateRef.current('stopped');
    await Promise.resolve();
    engine.requestMic();
    expect(createPitchDetector).toHaveBeenCalledTimes(2);
  });

  it('onState("denied") seguido de onError en el mismo tick no traga el error (secuencia real de pitch.js)', () => {
    const onError = vi.fn();
    const engine = createTunerEngine({ onPitch: vi.fn(), onState: vi.fn(), onError });
    engine.start();
    const err = new Error('Permission denied');
    // pitch.js llama onState('denied') y LUEGO onError(e) sincrónicamente en
    // el mismo tick (ver el catch de start() en pitch.js) — el nuleo de
    // `detector` en el wrapper de onState no debe adelantarse a esto.
    onStateRef.current('denied');
    onErrorRef.current(err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('onState("denied")+onError en el mismo tick no rompe el reintento posterior', async () => {
    const onError = vi.fn();
    const engine = createTunerEngine({ onPitch: vi.fn(), onState: vi.fn(), onError });
    engine.start();
    onStateRef.current('denied');
    onErrorRef.current(new Error('Permission denied'));
    await Promise.resolve();
    engine.requestMic();
    expect(createPitchDetector).toHaveBeenCalledTimes(2);
  });
});

describe('colorFromCents', () => {
  it('ok <10, warn <30, bad resto (incluye desviaciones grandes)', () => {
    expect(colorFromCents(5)).toBe('ok');
    expect(colorFromCents(-9)).toBe('ok');
    expect(colorFromCents(20)).toBe('warn');
    expect(colorFromCents(45)).toBe('bad');
    expect(colorFromCents(200)).toBe('bad');
  });
});

