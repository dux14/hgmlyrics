import { describe, it, expect } from 'vitest';
import { createSpring } from '../src/lib/spring.js';

describe('createSpring', () => {
  it('converge al target y reporta reposo', () => {
    const s = createSpring();
    s.snap(0);
    s.setTarget(100);
    let guard = 0;
    while (s.step(16) && guard++ < 1000) {
      // avanzar hasta reposo
    }
    expect(s.getValue()).toBeCloseTo(100, 1);
  });

  it('es interrumpible: retarget a mitad de vuelo no salta', () => {
    const s = createSpring();
    s.snap(0);
    s.setTarget(100);
    for (let i = 0; i < 5; i++) s.step(16);
    const mid = s.getValue();
    s.setTarget(-50);
    s.step(16);
    expect(Math.abs(s.getValue() - mid)).toBeLessThan(20); // continuo, sin teleport
  });

  it('snap fija valor y velocidad 0', () => {
    const s = createSpring();
    s.setTarget(100);
    for (let i = 0; i < 5; i++) s.step(16);
    s.snap(42);
    expect(s.getValue()).toBe(42);
    // velocidad 0 implica que un step posterior con target=42 no se mueve mas y reposa
    const animating = s.step(16);
    expect(animating).toBe(false);
    expect(s.getValue()).toBe(42);
  });

  it('step devuelve false y deja el valor exacto en el target al reposar', () => {
    const s = createSpring();
    s.snap(0);
    s.setTarget(10);
    let animating = true;
    let guard = 0;
    while (animating && guard++ < 1000) {
      animating = s.step(16);
    }
    expect(animating).toBe(false);
    expect(s.getValue()).toBe(10);
  });

  it('clampa dt grandes (no explota con un frame lento)', () => {
    const s = createSpring();
    s.snap(0);
    s.setTarget(100);
    expect(() => s.step(5000)).not.toThrow();
    expect(Number.isFinite(s.getValue())).toBe(true);
  });

  it('step(64) repetido converge acotado (dispositivo lento a ~15fps)', () => {
    const s = createSpring();
    s.snap(0);
    s.setTarget(100);
    for (let i = 0; i < 500; i++) {
      s.step(64);
      expect(Number.isFinite(s.getValue())).toBe(true);
      expect(Math.abs(s.getValue())).toBeLessThan(1000); // acotado, sin fuga a infinito
    }
    expect(s.getValue()).toBeCloseTo(100, 1);
  });

  it('ignora setTarget con valor no finito (no envenena el estado)', () => {
    const s = createSpring();
    s.snap(0);
    s.setTarget(NaN);
    s.step(16);
    expect(Number.isFinite(s.getValue())).toBe(true);
    s.setTarget(50);
    let guard = 0;
    while (s.step(16) && guard++ < 1000) {
      // avanzar hasta reposo
    }
    expect(s.getValue()).toBeCloseTo(50, 1);
  });

  it('ignora snap con valor no finito (no envenena el estado)', () => {
    const s = createSpring();
    s.snap(0);
    s.snap(Infinity);
    expect(s.getValue()).toBe(0);
    s.setTarget(20);
    let guard = 0;
    while (s.step(16) && guard++ < 1000) {
      // avanzar hasta reposo
    }
    expect(s.getValue()).toBeCloseTo(20, 1);
  });

  it('clampa dt negativo a 0 (no retrocede)', () => {
    const s = createSpring();
    s.snap(0);
    s.setTarget(100);
    s.step(16);
    const before = s.getValue();
    s.step(-50);
    expect(s.getValue()).toBe(before);
  });

  it('converge con dt jittery (16/17/15/32 alternados)', () => {
    const s = createSpring();
    s.snap(0);
    s.setTarget(100);
    const jitter = [16, 17, 15, 32];
    let guard = 0;
    let animating = true;
    while (animating && guard < 1000) {
      animating = s.step(jitter[guard % jitter.length]);
      guard++;
    }
    expect(animating).toBe(false);
    expect(s.getValue()).toBeCloseTo(100, 1);
  });
});
