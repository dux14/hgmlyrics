/**
 * input.test.js — Lógica pura del bridge de input (teclado + joystick).
 *
 * mergeInputVector: combina el vector de teclado (prioritario) con el del
 * joystick (analógico, con deadzone). deriveDir: deriva la dirección dominante.
 */
import { describe, it, expect } from 'vitest';
import { mergeInputVector, deriveDir } from '../../src/world/input.js';

describe('mergeInputVector — teclado prioritario, joystick analógico', () => {
  const ZERO = { x: 0, y: 0 };

  it('sin input → {0,0}', () => {
    expect(mergeInputVector(ZERO, ZERO)).toEqual({ x: 0, y: 0 });
  });

  it('teclado activo tiene prioridad sobre el joystick', () => {
    const kb = { x: 1, y: 0 };
    const js = { x: -1, y: 0 };
    expect(mergeInputVector(kb, js)).toEqual({ x: 1, y: 0 });
  });

  it('sin teclado → usa el joystick si supera la deadzone', () => {
    const js = { x: 0.8, y: 0 };
    expect(mergeInputVector(ZERO, js)).toEqual({ x: 0.8, y: 0 });
  });

  it('joystick por debajo de la deadzone → {0,0} (evita drift)', () => {
    const js = { x: 0.1, y: 0.05 };
    expect(mergeInputVector(ZERO, js)).toEqual({ x: 0, y: 0 });
  });

  it('preserva la magnitud analógica del joystick (no fuerza a 1)', () => {
    const js = { x: 0.5, y: 0 };
    const out = mergeInputVector(ZERO, js);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(0.5, 5);
  });
});

describe('deriveDir — dirección dominante', () => {
  it('sin movimiento → conserva lastDir', () => {
    expect(deriveDir(0, 0, 'left')).toBe('left');
  });

  it('horizontal dominante → left/right', () => {
    expect(deriveDir(1, 0.2, 'down')).toBe('right');
    expect(deriveDir(-1, 0.2, 'down')).toBe('left');
  });

  it('vertical dominante → up/down (y positivo = abajo en pantalla)', () => {
    expect(deriveDir(0.2, 1, 'left')).toBe('down');
    expect(deriveDir(0.2, -1, 'left')).toBe('up');
  });

  it('empate exacto → prioriza el eje vertical', () => {
    expect(deriveDir(0.5, 0.5, 'left')).toBe('down');
    expect(deriveDir(0.5, -0.5, 'left')).toBe('up');
  });
});
