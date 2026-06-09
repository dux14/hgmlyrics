// tests/calibration.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CAL_KEY,
  getCalibrationCents,
  setCalibrationCents,
  applyCalibration,
  centsToA4,
  a4ToCents,
} from '../src/lib/calibration.js';

describe('calibración: persistencia', () => {
  beforeEach(() => localStorage.clear());

  it('default 0 cuando no hay nada guardado', () => {
    expect(getCalibrationCents()).toBe(0);
  });

  it('persiste y recupera el offset', () => {
    setCalibrationCents(12);
    expect(getCalibrationCents()).toBe(12);
    expect(localStorage.getItem(CAL_KEY)).toBe('12');
  });

  it('hace clamp a [-100, 100]', () => {
    setCalibrationCents(999);
    expect(getCalibrationCents()).toBe(100);
    setCalibrationCents(-999);
    expect(getCalibrationCents()).toBe(-100);
  });

  it('valores corruptos en storage vuelven a 0', () => {
    localStorage.setItem(CAL_KEY, 'basura');
    expect(getCalibrationCents()).toBe(0);
  });
});

describe('applyCalibration', () => {
  it('con 0 cents no cambia el hz', () => {
    expect(applyCalibration(440, 0)).toBeCloseTo(440, 6);
  });

  it('si el dispositivo lee sostenido (+cents), baja el hz', () => {
    // +100 cents = un semitono; 440 debería corregirse hacia ~415.3.
    expect(applyCalibration(440, 100)).toBeCloseTo(440 * Math.pow(2, -100 / 1200), 6);
    expect(applyCalibration(440, 100)).toBeLessThan(440);
  });
});

describe('cents <-> A4', () => {
  it('centsToA4(0) = 440 y a4ToCents(440) = 0', () => {
    expect(centsToA4(0)).toBeCloseTo(440, 6);
    expect(a4ToCents(440)).toBeCloseTo(0, 6);
  });

  it('son inversas', () => {
    expect(a4ToCents(centsToA4(37))).toBeCloseTo(37, 6);
  });
});
