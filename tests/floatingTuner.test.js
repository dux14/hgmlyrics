import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub pitch detector (requiere AudioContext/getUserMedia, no disponible en
// jsdom) — mismo patrón que tests/stageMode.test.js.
const detectorStart = vi.fn();
const detectorStop = vi.fn();
vi.mock('../src/lib/pitch.js', () => ({
  createPitchDetector: vi.fn(() => ({
    start: detectorStart,
    stop: detectorStop,
    isRunning: () => false,
  })),
}));

const { openFloatingTuner } = await import('../src/components/FloatingTuner.js');

describe('FloatingTuner — modo libre sin voz seleccionada', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    detectorStart.mockClear();
    detectorStop.mockClear();
  });

  it('abre con note:null en modo libre: sin nota objetivo, arranca el detector igual', () => {
    const api = openFloatingTuner(document.body, { note: null, voiceLabel: 'Afinador' });
    expect(document.querySelector('.floating-tuner')).toBeTruthy();
    expect(document.getElementById('floating-tuner-note').textContent).toBe('—');
    expect(detectorStart).toHaveBeenCalledTimes(1);
    api.destroy();
  });

  it('abre con una nota objetivo: la muestra formateada', () => {
    const api = openFloatingTuner(document.body, { note: 'C4', voiceLabel: 'Soprano' });
    expect(document.getElementById('floating-tuner-note').textContent).not.toBe('—');
    api.destroy();
  });

  it('setNote(null) vuelve a modo libre tras haber tenido una voz activa', () => {
    const api = openFloatingTuner(document.body, { note: 'C4', voiceLabel: 'Soprano' });
    api.setNote(null);
    expect(document.getElementById('floating-tuner-note').textContent).toBe('—');
    api.destroy();
  });

  it('destroy() para el detector y remueve el elemento', () => {
    const api = openFloatingTuner(document.body, { note: null });
    api.destroy();
    expect(detectorStop).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.floating-tuner')).toBeNull();
  });
});
