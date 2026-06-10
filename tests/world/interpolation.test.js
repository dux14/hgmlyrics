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

  it('buffer vacío → sample() retorna null', () => {
    const b = new PeerBuffer({ delayMs: 100 });
    expect(b.sample(1000)).toBeNull();
  });

  it('target exactamente en el t de la muestra más antigua → devuelve esa posición sin lerp', () => {
    const b = new PeerBuffer({ delayMs: 0 });
    b.push({ x: 10, y: 20, t: 500 });
    b.push({ x: 90, y: 80, t: 600 });
    // delayMs=0, now=500 → target=500 = q[0].t → debe devolver primera muestra exacta
    const s = b.sample(500);
    expect(s.x).toBe(10);
    expect(s.y).toBe(20);
  });

  it('sample() que avanza al segundo segmento poda las muestras anteriores', () => {
    const b = new PeerBuffer({ delayMs: 0 });
    b.push({ x: 0, y: 0, t: 1000 });
    b.push({ x: 10, y: 0, t: 1100 });
    b.push({ x: 20, y: 0, t: 1200 });
    // target = 1150 → interpolación en segmento [1100, 1200], s0 en índice 1 → poda índice 0
    b.sample(1150);
    expect(b._samples.length).toBeLessThan(3);
  });

  it('push fuera de orden o duplicado es ignorado', () => {
    const b = new PeerBuffer({ delayMs: 100 });
    b.push({ x: 0, y: 0, t: 1000 });
    b.push({ x: 50, y: 0, t: 1100 });
    const lenBefore = b._samples.length;
    // t=1100 duplicado — debe ignorarse
    b.push({ x: 99, y: 99, t: 1100 });
    // t=900 rezagado — debe ignorarse
    b.push({ x: 99, y: 99, t: 900 });
    expect(b._samples.length).toBe(lenBefore);
    // el resultado de sample tampoco se ve afectado por los pushes ignorados
    const s = b.sample(1200); // target=1100 → última muestra conocida
    expect(s.x).toBe(50);
  });
});
