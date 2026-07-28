import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWaveRange } from './waveRange.js';

beforeEach(() => {
  // jsdom no implementa getContext; devolvemos un stub que registre llamadas.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }));
});

describe('createWaveRange', () => {
  it('devuelve un canvas', () => {
    const { el } = createWaveRange({ low: 'C3', high: 'A5' });
    expect(el.tagName).toBe('CANVAS');
  });

  it('no arranca el loop de animacion bajo prefers-reduced-motion', () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn() }));
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    createWaveRange({ low: 'C3', high: 'A5' });
    // El montaje puede programar 1 rAF para medir/pintar un frame estatico,
    // pero NO debe arrancar un loop que se re-encola.
    expect(raf.mock.calls.length).toBeLessThanOrEqual(1);
    raf.mockRestore();
  });

  it('devuelve null-ish sin rango valido', () => {
    expect(createWaveRange({ low: '', high: '' })).toBeNull();
  });
});
