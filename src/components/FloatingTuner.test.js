import { describe, it, expect, vi, afterEach } from 'vitest';

// jsdom no tiene Web Audio: mockeamos createTunerEngine (createTunerStrip
// queda intacta para StageMode, no la usa este componente). Capturamos los
// callbacks para simular onState/onPitch a mano, como haría pitch.js real.
let engineCallbacks;
vi.mock('../lib/tunerWidget.js', () => ({
  createTunerEngine: vi.fn((opts) => {
    engineCallbacks = opts;
    return {
      start: vi.fn(),
      stop: vi.fn(),
      requestMic: vi.fn(),
      isRunning: () => true,
    };
  }),
  colorFromCents: (cents) => {
    const abs = Math.abs(cents);
    if (abs < 10) return 'ok';
    if (abs < 30) return 'warn';
    return 'bad';
  },
}));

import { openFloatingTuner } from './FloatingTuner.js';
import { createTunerEngine } from '../lib/tunerWidget.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

function makeContainer() {
  // Notación anglo fija: displayNote() por defecto usa latin (Do Re Mi) via
  // getChordNotation(), y este test verifica el texto literal de la nota.
  localStorage.setItem('hkn-chord-notation', 'anglo');
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('FloatingTuner — barra flotante híbrida', () => {
  it('monta .floating-tuner y arranca el motor al abrir', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    expect(container.querySelector('.floating-tuner')).toBeTruthy();
    const instance = createTunerEngine.mock.results[0].value;
    expect(instance.start).toHaveBeenCalledTimes(1);
  });

  it('el botón X tiene aria-label "Cerrar afinador"', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    expect(container.querySelector('[aria-label="Cerrar afinador"]')).toBeTruthy();
  });

  it('el gate de micrófono se muestra mientras el motor no está corriendo', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    expect(container.querySelector('.floating-tuner__grant')).toBeTruthy();
  });

  it('abre en modo libre aunque se pase note: la nota detectada manda, no la objetivo', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    engineCallbacks.onState('running');
    engineCallbacks.onPitch({ hz: 440, note: 'A', octave: 4, cents: 3, midi: 69 });
    expect(document.getElementById('floating-tuner-note').textContent).toContain('A4');
  });

  it('el chip "Seguir nota" es visible solo si hay note disponible', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    engineCallbacks.onState('running');
    expect(document.getElementById('floating-tuner-chip')).toBeTruthy();
  });

  it('sin note disponible (sin voz activa), el chip no se muestra', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: null, voiceLabel: 'Afinador' });
    engineCallbacks.onState('running');
    expect(document.getElementById('floating-tuner-chip')).toBeNull();
  });

  it('activar el chip mide cents contra la nota objetivo (100*(midi-target)+cents)', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'A4', voiceLabel: 'Contralto' });
    engineCallbacks.onState('running');
    document.getElementById('floating-tuner-chip').click();
    // A4 = midi 69; detectamos B4 (midi 71) con 5 cents finos.
    engineCallbacks.onPitch({ hz: 493, note: 'B', octave: 4, cents: 5, midi: 71 });
    expect(document.getElementById('floating-tuner-note').textContent).toContain('A4');
    expect(document.getElementById('floating-tuner-cents').textContent).toContain('205');
  });

  it('desactivar el chip vuelve a modo libre', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'A4', voiceLabel: 'Contralto' });
    engineCallbacks.onState('running');
    const chip = document.getElementById('floating-tuner-chip');
    chip.click(); // encendido
    chip.click(); // apagado: vuelve a libre
    engineCallbacks.onPitch({ hz: 493, note: 'B', octave: 4, cents: 5, midi: 71 });
    expect(document.getElementById('floating-tuner-note').textContent).toContain('B4');
  });

  it('setNote(null) con chip activo vuelve a modo libre y oculta el chip', () => {
    const container = makeContainer();
    const tuner = openFloatingTuner(container, { note: 'A4', voiceLabel: 'Contralto' });
    engineCallbacks.onState('running');
    document.getElementById('floating-tuner-chip').click();
    tuner.setNote(null);
    expect(document.getElementById('floating-tuner-chip')).toBeNull();
    engineCallbacks.onPitch({ hz: 493, note: 'B', octave: 4, cents: 5, midi: 71 });
    expect(document.getElementById('floating-tuner-note').textContent).toContain('B4');
  });

  it('el chip nace apagado en cada apertura (no persiste)', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'A4', voiceLabel: 'Contralto' });
    engineCallbacks.onState('running');
    expect(document.getElementById('floating-tuner-chip').getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('click en X llama onClose y desmonta', () => {
    const container = makeContainer();
    const onClose = vi.fn();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto', onClose });
    const closeBtn = container.querySelector('[aria-label="Cerrar afinador"]');
    closeBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.floating-tuner')).toBeNull();
  });

  it('destroy() desmonta, para el motor y es idempotente', () => {
    const container = makeContainer();
    const tuner = openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    const instance = createTunerEngine.mock.results[0].value;
    tuner.destroy();
    expect(instance.stop).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.floating-tuner')).toBeNull();
    expect(() => tuner.destroy()).not.toThrow();
  });

  it('Escape cierra igual que la X y llama onClose', () => {
    const container = makeContainer();
    const onClose = vi.fn();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto', onClose });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.floating-tuner')).toBeNull();
  });

  it('el listener de Escape no queda colgado tras destroy (un 2do Escape no re-llama onClose)', () => {
    const container = makeContainer();
    const onClose = vi.fn();
    const tuner = openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto', onClose });
    tuner.destroy();
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ).not.toThrow();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mueve el foco al botón de cerrar al abrir', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    const closeBtn = container.querySelector('[aria-label="Cerrar afinador"]');
    expect(document.activeElement).toBe(closeBtn);
  });
});
