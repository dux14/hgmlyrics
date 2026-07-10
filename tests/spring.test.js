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
});
