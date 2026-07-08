import { describe, it, expect, vi, afterEach } from 'vitest';

// jsdom no tiene Web Audio: mockeamos tunerWidget.js. El test cubre el
// contenedor flotante (header, nota, X, onClose, destroy), no el DSP.
vi.mock('../lib/tunerWidget.js', () => ({
  createTunerStrip: vi.fn(() => {
    const el = document.createElement('div');
    el.className = 'tuner-strip';
    return {
      el,
      start: vi.fn(),
      stop: vi.fn(),
      setTargetNote: vi.fn(),
      isRunning: () => false,
    };
  }),
}));

import { openFloatingTuner } from './FloatingTuner.js';
import { createTunerStrip } from '../lib/tunerWidget.js';

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

describe('FloatingTuner — barra flotante bajo demanda', () => {
  it('monta .floating-tuner con la nota objetivo visible', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    const el = container.querySelector('.floating-tuner');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('F#3');
  });

  it('muestra el label de voz + "nota objetivo"', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    expect(container.textContent).toContain('Contralto');
    expect(container.textContent).toContain('nota objetivo');
  });

  it('el botón X tiene aria-label "Cerrar afinador"', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    const closeBtn = container.querySelector('[aria-label="Cerrar afinador"]');
    expect(closeBtn).toBeTruthy();
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

  it('destroy() desmonta y es idempotente', () => {
    const container = makeContainer();
    const tuner = openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    tuner.destroy();
    expect(container.querySelector('.floating-tuner')).toBeNull();
    expect(() => tuner.destroy()).not.toThrow();
  });

  it('arranca el detector al abrir (gesto de usuario ya ocurrido en el mic click)', () => {
    const container = makeContainer();
    openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    const instance = createTunerStrip.mock.results[0].value;
    expect(instance.start).toHaveBeenCalledTimes(1);
  });

  it('setNote actualiza la nota mostrada y el target del strip', () => {
    const container = makeContainer();
    const tuner = openFloatingTuner(container, { note: 'F#3', voiceLabel: 'Contralto' });
    tuner.setNote('A4');
    const instance = createTunerStrip.mock.results[0].value;
    expect(container.querySelector('.floating-tuner').textContent).toContain('A4');
    expect(instance.setTargetNote).toHaveBeenCalled();
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
