import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub pitch detector (requires AudioContext/getUserMedia) — mismo patrón que tuner.test.js.
const onPitchRef = { current: null };
const onStateRef = { current: null };
const detectorStart = vi.fn();
const detectorStop = vi.fn();

vi.mock('../src/lib/pitch.js', () => ({
  createPitchDetector: vi.fn((opts) => {
    onPitchRef.current = opts.onPitch;
    onStateRef.current = opts.onState;
    return { start: detectorStart, stop: detectorStop, isRunning: () => false };
  }),
}));

const { createTunerStrip, colorFromCents } = await import('../src/lib/tunerWidget.js');
const { noteToMidi } = await import('../src/lib/notes.js');

beforeEach(() => {
  localStorage.clear();
  detectorStart.mockClear();
  detectorStop.mockClear();
  onPitchRef.current = null;
  onStateRef.current = null;
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
  it('actualiza el label con la notacion global (latin por defecto)', () => {
    const strip = createTunerStrip({});
    strip.start();
    onStateRef.current('running'); // simula permiso concedido
    strip.setTargetNote(noteToMidi('D4'));
    expect(strip.el.querySelector('#tuner-strip-label').textContent).toBe('Re4');
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
