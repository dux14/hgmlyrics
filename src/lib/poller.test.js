import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPoller } from './poller.js';

// Helper: fuerza document.visibilityState (jsdom lo define como getter no configurable
// por defecto en algunos entornos, así que redefinimos la propiedad completa).
function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('createPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ejecuta fn cada intervalMs mientras la pestaña está visible', () => {
    const fn = vi.fn();
    const poller = createPoller(fn, 1000);
    poller.start();

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);

    expect(fn).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('no ejecuta fn mientras la pestaña está oculta', () => {
    const fn = vi.fn();
    const poller = createPoller(fn, 1000);
    poller.start();

    setVisibility('hidden');
    vi.advanceTimersByTime(5000);

    expect(fn).not.toHaveBeenCalled();
    poller.stop();
  });

  it('al volver a visible con el intervalo vencido, ejecuta de inmediato y reanuda la cadencia', () => {
    const fn = vi.fn();
    const poller = createPoller(fn, 1000);
    poller.start();

    setVisibility('hidden');
    vi.advanceTimersByTime(5000); // intervalo vencido de sobra, oculto
    expect(fn).not.toHaveBeenCalled();

    setVisibility('visible'); // debe disparar de inmediato al reanudar
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000); // cadencia reanudada normalmente
    expect(fn).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('stop() limpia el timer y el listener: no vuelve a ejecutar', () => {
    const fn = vi.fn();
    const poller = createPoller(fn, 1000);
    poller.start();

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    poller.stop();
    vi.advanceTimersByTime(5000);
    setVisibility('hidden');
    setVisibility('visible');

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
