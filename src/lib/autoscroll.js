/**
 * autoscroll.js — utilidades puras para scroll dinámico.
 */

// ── Velocidad continua (px/frame), compartida por el autoscroll clásico
// (SongView) y el gesto de velocidad del stage (StageMode).
export const AUTOSCROLL_SPEED_KEY = 'hkn-autoscroll-speed';
export const AUTOSCROLL_SPEED_MIN = 0.01;
export const AUTOSCROLL_SPEED_MAX = 2.0;
export const AUTOSCROLL_SPEED_DEFAULT = 0.5;

/**
 * Lee la velocidad continua guardada, por canción o global.
 * Best-effort: localStorage roto (Safari privado, cuota) → default.
 * @param {string|undefined} songId
 * @returns {number} velocidad en [AUTOSCROLL_SPEED_MIN, AUTOSCROLL_SPEED_MAX]
 */
export function getAutoscrollSpeed(songId) {
  try {
    const perSong = songId && localStorage.getItem(`${AUTOSCROLL_SPEED_KEY}:${songId}`);
    const stored = perSong ?? localStorage.getItem(AUTOSCROLL_SPEED_KEY);
    if (stored) {
      const val = Number.parseFloat(stored);
      if (val >= AUTOSCROLL_SPEED_MIN && val <= AUTOSCROLL_SPEED_MAX) return val;
    }
  } catch {
    /* localStorage puede fallar (Safari privado, cuota) */
  }
  return AUTOSCROLL_SPEED_DEFAULT;
}

/**
 * Persiste la velocidad continua, por canción si hay songId, si no global.
 * @param {number} speed @param {string|undefined} songId
 */
export function saveAutoscrollSpeed(speed, songId) {
  try {
    const key = songId ? `${AUTOSCROLL_SPEED_KEY}:${songId}` : AUTOSCROLL_SPEED_KEY;
    localStorage.setItem(key, speed.toString());
  } catch {
    /* localStorage puede fallar (Safari privado, cuota) */
  }
}

/** @param {number} speed @returns {string} p.ej. "65%" */
export function speedToPercentLabel(speed) {
  return `${Math.round(speed * 100)}%`;
}

/**
 * Mapea un speedPreset (0–100) al multiplicador de velocidad del autoscroll.
 * @param {number|null|undefined} preset
 * @param {{min:number, max:number}} range
 * @returns {number|null} multiplicador, o null si preset inválido.
 */
export function presetToSpeed(preset, range) {
  if (typeof preset !== 'number' || Number.isNaN(preset)) return null;
  const p = Math.max(0, Math.min(100, preset));
  return range.min + (range.max - range.min) * (p / 100);
}

/**
 * Da un paso de `step` desde `current` hacia `target` sin sobrepasar.
 * @param {number} current
 * @param {number} target
 * @param {number} step
 * @returns {number}
 */
export function stepToward(current, target, step) {
  if (current === target) return target;
  const dir = target > current ? 1 : -1;
  const next = current + dir * Math.abs(step);
  return dir > 0 ? Math.min(next, target) : Math.max(next, target);
}

/**
 * Decide si el FAB de autoscroll debe mostrarse.
 * Oculto en el header (tope); visible al leer la letra. Si el autoscroll está
 * corriendo, siempre visible (para no perder el botón de pausa al volver arriba).
 * @param {boolean} headerVisible  el header de la canción está en viewport
 * @param {boolean} isScrolling    el autoscroll está corriendo
 * @returns {boolean}
 */
export function shouldShowFab(headerVisible, isScrolling) {
  if (isScrolling) return true;
  return !headerVisible;
}
