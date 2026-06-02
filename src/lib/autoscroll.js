/**
 * autoscroll.js — utilidades puras para scroll dinámico.
 */

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
