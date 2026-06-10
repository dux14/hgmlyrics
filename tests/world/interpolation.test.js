import { describe, it, expect } from 'vitest';
import { PeerBuffer } from '../../src/world/interpolation.js';

describe('PeerBuffer', () => {
  it('devuelve la posición exacta entre dos muestras (lerp)', () => {
    const b = new PeerBuffer({ delayMs: 100 });
    b.push({ x: 0, y: 0, t: 1000 });
    b.push({ x: 100, y: 0, t: 1100 });
    // render en t=1150 con delay 100 → punto efectivo t=1050 → mitad
    expect(b.sample(1150).x).toBeCloseTo(50, 0);
  });
  it('mantiene la última posición si no hay muestra futura', () => {
    const b = new PeerBuffer({ delayMs: 100 });
    b.push({ x: 100, y: 50, t: 1000 });
    const s = b.sample(2000);
    expect(s.x).toBe(100); expect(s.y).toBe(50);
  });
});
