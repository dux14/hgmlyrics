import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub pitch detector (requires AudioContext/getUserMedia) — mismo patrón que tuner.test.js.
const onPitchRef = { current: null };
const onStateRef = { current: null };
// start() por defecto resuelve de inmediato (contrato real de pitch.js: Promise<void>);
// los tests de carrera lo sobrescriben con mockImplementationOnce para controlarlo a mano.
const detectorStart = vi.fn(() => Promise.resolve());
const detectorStop = vi.fn();

vi.mock('../src/lib/pitch.js', () => ({
  createPitchDetector: vi.fn((opts) => {
    onPitchRef.current = opts.onPitch;
    onStateRef.current = opts.onState;
    return { start: detectorStart, stop: detectorStop, isRunning: () => false };
  }),
}));

const { createTunerStrip, createTunerEngine, colorFromCents } = await import(
  '../src/lib/tunerWidget.js'
);
const { createPitchDetector } = await import('../src/lib/pitch.js');
const { noteToMidi } = await import('../src/lib/notes.js');

beforeEach(() => {
  localStorage.clear();
  detectorStart.mockClear();
  detectorStop.mockClear();
  createPitchDetector.mockClear();
  onPitchRef.current = null;
  onStateRef.current = null;
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

describe('createTunerStrip — monta/desmonta', () => {
  it('start() pide el mic; stop() SIEMPRE libera el detector', () => {
    const strip = createTunerStrip({ getTargetNote: () => null });
    expect(strip.isRunning()).toBe(false);
    strip.start();
    expect(strip.isRunning()).toBe(true);
    expect(detectorStart).toHaveBeenCalledTimes(1);
    strip.stop();
    expect(strip.isRunning()).toBe(false);
    expect(detectorStop).toHaveBeenCalledTimes(1);
  });

  it('sin start(), el.innerHTML queda vacío (no hay gate visible)', () => {
    const strip = createTunerStrip({});
    expect(strip.el.innerHTML.trim()).toBe('');
  });

  it('running sin permiso concedido muestra el boton "Activar microfono"', () => {
    const strip = createTunerStrip({});
    strip.start();
    expect(strip.el.textContent).toContain('Activar micrófono');
  });
});

describe('createTunerStrip — setTargetNote', () => {
  it('actualiza el label con la notacion global (anglo por defecto)', () => {
    const strip = createTunerStrip({});
    strip.start();
    onStateRef.current('running'); // simula permiso concedido
    strip.setTargetNote(noteToMidi('D4'));
    expect(strip.el.querySelector('#tuner-strip-label').textContent).toBe('D4');
  });

  it('sin nota objetivo cae en modo libre (hint visible)', () => {
    const strip = createTunerStrip({});
    strip.start();
    onStateRef.current('running');
    strip.setTargetNote(null);
    expect(strip.el.textContent).toContain('Elige tu voz para afinar contra la nota');
  });
});

describe('createTunerStrip — cents relativos al objetivo', () => {
  it('detectado A4 vs objetivo G4 → +200¢, clamp al borde con estilo bad', () => {
    const strip = createTunerStrip({});
    strip.start();
    onStateRef.current('running');
    strip.setTargetNote(noteToMidi('G4'));
    // Simula la salida ya estabilizada del stabilizer (A4 exacto: cents finos 0).
    onPitchRef.current({ hz: 440, rms: 0.2, confidence: 1 });
    const indicator = strip.el.querySelector('#tuner-strip-indicator');
    expect(indicator.style.left).toBe('100%'); // clamp ±50¢ al borde
    expect(indicator.dataset.status).toBe('bad');
  });

  it('detectado exactamente en la nota objetivo → 0¢, estado ok, indicador centrado', () => {
    const strip = createTunerStrip({});
    strip.start();
    onStateRef.current('running');
    strip.setTargetNote(noteToMidi('A4'));
    onPitchRef.current({ hz: 440, rms: 0.2, confidence: 1 });
    const indicator = strip.el.querySelector('#tuner-strip-indicator');
    expect(indicator.style.left).toBe('50%');
    expect(indicator.dataset.status).toBe('ok');
  });
});

describe('createTunerStrip — carrera stop() durante start() en vuelo', () => {
  it('stop() antes de resolver start(): libera igual el mic (evita huerfano)', async () => {
    let resolveStart;
    detectorStart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        })
    );

    const strip = createTunerStrip({ getTargetNote: () => null });
    strip.start(); // requestMic() deja detector.start() en vuelo
    strip.stop(); // apaga ANTES de resolver: el stop() temprano es no-op real
    expect(detectorStop).toHaveBeenCalledTimes(1);

    resolveStart();
    await Promise.resolve();
    await Promise.resolve(); // deja correr el .then interno de requestMic

    // al resolver, requestMic ve que la epoca cambio (detector !== d) y libera
    // lo que start() acababa de abrir: segundo stop() = liberacion real.
    expect(detectorStop).toHaveBeenCalledTimes(2);
  });

  it('ON-OFF-ON rapido: solo queda un detector activo (el ultimo)', async () => {
    let resolveFirst;
    detectorStart
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(() => Promise.resolve());

    const strip = createTunerStrip({ getTargetNote: () => null });
    strip.start(); // detector #1 en vuelo
    strip.stop(); // apaga antes de resolver
    strip.start(); // vuelve a encender -> detector #2

    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve(); // resolucion del #2 + limpieza del #1 huerfano

    expect(strip.isRunning()).toBe(true);
    expect(detectorStart).toHaveBeenCalledTimes(2);
    // stop temprano del #1 (no-op) + liberacion diferida del #1 tras resolver = 2
    expect(detectorStop).toHaveBeenCalledTimes(2);
  });
});
