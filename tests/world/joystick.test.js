import { describe, it, expect, vi } from 'vitest';
import { computeVector } from '../../src/components/Joystick.js';

describe('computeVector — math pura del joystick', () => {
  const R = 60;

  it('centro (dx=0, dy=0) → {x:0, y:0}', () => {
    expect(computeVector(0, 0, R)).toEqual({ x: 0, y: 0 });
  });

  it('desplazamiento parcial dentro del radio → componente proporcional (dx=R/2 → x=0.5)', () => {
    const v = computeVector(R / 2, 0, R);
    expect(v.x).toBeCloseTo(0.5, 5);
    expect(v.y).toBeCloseTo(0, 5);
  });

  it('desplazamiento en el borde (dx=R) → x=1', () => {
    const v = computeVector(R, 0, R);
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0, 5);
  });

  it('desplazamiento más allá del radio → magnitud clampeada a 1', () => {
    // más allá del borde en diagonal
    const v = computeVector(R * 2, R * 2, R);
    const mag = Math.hypot(v.x, v.y);
    expect(mag).toBeCloseTo(1, 5);
  });

  it('vector más allá del radio en eje X → x=1', () => {
    const v = computeVector(R * 3, 0, R);
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0, 5);
  });

  it('dy positivo produce y positivo (sin inversión de eje Y)', () => {
    const v = computeVector(0, R / 2, R);
    expect(v.y).toBeCloseTo(0.5, 5);
    expect(v.x).toBeCloseTo(0, 5);
  });

  it('negativo funciona simétricamente', () => {
    const vPos = computeVector(R / 2, R / 2, R);
    const vNeg = computeVector(-R / 2, -R / 2, R);
    expect(vNeg.x).toBeCloseTo(-vPos.x, 5);
    expect(vNeg.y).toBeCloseTo(-vPos.y, 5);
  });
});

// Test de componente (DOM / Pointer Events en jsdom)
// jsdom soporta PointerEvent desde Node 18+; hacemos un smoke test mínimo:
// al soltar el joystick, onChange recibe {x:0, y:0}.
describe('Joystick component — smoke test (pointerup emite {x:0,y:0})', () => {
  it('onChange({x:0,y:0}) al disparar pointerup en el base', async () => {
    const { Joystick } = await import('../../src/components/Joystick.js');
    const onChange = vi.fn();
    const { el, destroy } = Joystick({ onChange, radius: 60 });

    // Necesitamos que el base esté en el documento para que Pointer Events funcionen
    document.body.appendChild(el);

    // Simular pointerdown en el centro del base (para activar estado activo)
    const base = el.querySelector('[data-joystick-base]');
    const thumb = el.querySelector('[data-joystick-thumb]');
    expect(base).toBeTruthy();
    expect(thumb).toBeTruthy();

    // Disparar pointerdown (activa el tracking)
    base.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));

    // Disparar pointerup (debe resetear y llamar onChange con cero)
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith({ x: 0, y: 0 });

    destroy();
    document.body.removeChild(el);
  });
});
