import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub pitch detector (requiere AudioContext/getUserMedia, no disponible en
// jsdom) — mismo patrón que tests/stageMode.test.js. El mock nunca dispara
// onState/onPitch, así que el motor se queda en el gate de mic: esta suite
// cubre el ciclo de vida real de createTunerEngine (start/stop), no la
// lógica del chip (ver src/components/FloatingTuner.test.js para eso, con
// onState/onPitch simulados a mano).
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

describe('FloatingTuner — modo libre por defecto (integración con el motor real)', () => {
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

  it('abre con una nota de voz disponible: arranca en modo libre igual (no la fija como objetivo)', () => {
    const api = openFloatingTuner(document.body, { note: 'C4', voiceLabel: 'Soprano' });
    expect(document.getElementById('floating-tuner-note').textContent).toBe('—');
    api.destroy();
  });

  it('el gate de micrófono se muestra mientras no hay estado running', () => {
    const api = openFloatingTuner(document.body, { note: 'C4', voiceLabel: 'Soprano' });
    expect(document.querySelector('.floating-tuner__grant')).toBeTruthy();
    api.destroy();
  });

  it('setNote(null) mantiene el modo libre (sin voz activa no hay chip que ocultar)', () => {
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
