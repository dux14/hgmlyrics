import { describe, it, expect, beforeEach } from 'vitest';
import {
  presetToSpeed,
  stepToward,
  shouldShowFab,
  getAutoscrollSpeed,
  saveAutoscrollSpeed,
  speedToPercentLabel,
  AUTOSCROLL_SPEED_DEFAULT,
} from '../src/lib/autoscroll.js';

describe('presetToSpeed', () => {
  const range = { min: 0.5, max: 3 };
  it('mapea 0 → min y 100 → max', () => {
    expect(presetToSpeed(0, range)).toBeCloseTo(0.5);
    expect(presetToSpeed(100, range)).toBeCloseTo(3);
  });
  it('mapea 50 → punto medio', () => {
    expect(presetToSpeed(50, range)).toBeCloseTo(1.75);
  });
  it('clampa fuera de rango', () => {
    expect(presetToSpeed(-10, range)).toBeCloseTo(0.5);
    expect(presetToSpeed(200, range)).toBeCloseTo(3);
  });
  it('preset inválido devuelve null', () => {
    expect(presetToSpeed(null, range)).toBe(null);
    expect(presetToSpeed(undefined, range)).toBe(null);
  });
});

describe('stepToward', () => {
  it('avanza hacia el objetivo sin pasarse', () => {
    expect(stepToward(1.0, 1.5, 0.2)).toBeCloseTo(1.2);
    expect(stepToward(1.0, 1.05, 0.2)).toBeCloseTo(1.05); // no se pasa
  });
  it('baja hacia el objetivo', () => {
    expect(stepToward(2.0, 1.5, 0.2)).toBeCloseTo(1.8);
  });
  it('si ya está en el objetivo, lo mantiene', () => {
    expect(stepToward(1.5, 1.5, 0.2)).toBeCloseTo(1.5);
  });
});

// FIX 6: helpers de velocidad compartidos entre SongView y ImmersiveView.
describe('getAutoscrollSpeed / saveAutoscrollSpeed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sin nada guardado, devuelve el default', () => {
    expect(getAutoscrollSpeed('song-1')).toBe(AUTOSCROLL_SPEED_DEFAULT);
  });

  it('guarda y lee por canción, sin pisar la clave global', () => {
    saveAutoscrollSpeed(1.2, 'song-1');
    expect(getAutoscrollSpeed('song-1')).toBeCloseTo(1.2);
    expect(getAutoscrollSpeed('song-2')).toBe(AUTOSCROLL_SPEED_DEFAULT);
  });

  it('sin songId, guarda y lee la clave global', () => {
    saveAutoscrollSpeed(0.8, undefined);
    expect(getAutoscrollSpeed(undefined)).toBeCloseTo(0.8);
  });

  it('valor guardado fuera de rango se ignora y devuelve el default', () => {
    localStorage.setItem('hkn-autoscroll-speed:song-1', '99');
    expect(getAutoscrollSpeed('song-1')).toBe(AUTOSCROLL_SPEED_DEFAULT);
  });
});

describe('speedToPercentLabel', () => {
  it('formatea la velocidad como porcentaje redondeado', () => {
    expect(speedToPercentLabel(0.5)).toBe('50%');
    expect(speedToPercentLabel(1)).toBe('100%');
    expect(speedToPercentLabel(0.654)).toBe('65%');
  });
});

describe('shouldShowFab', () => {
  it('oculta el FAB cuando el header es visible y no está scrolleando', () => {
    expect(shouldShowFab(true, false)).toBe(false);
  });
  it('muestra el FAB cuando el header no es visible', () => {
    expect(shouldShowFab(false, false)).toBe(true);
  });
  it('muestra el FAB siempre que el autoscroll esté corriendo', () => {
    expect(shouldShowFab(true, true)).toBe(true);
    expect(shouldShowFab(false, true)).toBe(true);
  });
});
