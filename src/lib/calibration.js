// src/lib/calibration.js
/**
 * calibration.js — Calibración del afinador para compensar el desfase del
 * micrófono/dispositivo respecto a la afinación "real" (A4=440).
 * El offset se mide en cents y se persiste en localStorage.
 * Puro y síncrono (salvo el acceso a localStorage, protegido con try/catch).
 */
export const CAL_KEY = 'hkn-tuner-cal-cents';
const CAL_MIN = -100;
const CAL_MAX = 100;

function clamp(c) {
  if (!Number.isFinite(c)) return 0;
  return Math.max(CAL_MIN, Math.min(CAL_MAX, Math.round(c)));
}

/** @returns {number} Offset de calibración en cents (default 0). */
export function getCalibrationCents() {
  try {
    const raw = localStorage.getItem(CAL_KEY);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? clamp(n) : 0;
  } catch (_e) {
    return 0;
  }
}

/** @param {number} cents */
export function setCalibrationCents(cents) {
  const c = clamp(cents);
  try {
    localStorage.setItem(CAL_KEY, String(c));
  } catch (_e) {
    /* ignore */
  }
  return c;
}

/**
 * Corrige un hz detectado según el offset de calibración.
 * calCents > 0 significa que el dispositivo lee sostenido → bajamos el hz.
 * @param {number} hz
 * @param {number} calCents
 * @returns {number}
 */
export function applyCalibration(hz, calCents) {
  if (!Number.isFinite(hz) || hz <= 0 || !calCents) return hz;
  return hz * Math.pow(2, -calCents / 1200);
}

/** Frecuencia de A4 equivalente a un offset en cents. */
export function centsToA4(cents) {
  return 440 * Math.pow(2, cents / 1200);
}

/** Offset en cents equivalente a una frecuencia de A4 dada. */
export function a4ToCents(hz) {
  return 1200 * Math.log2(hz / 440);
}
