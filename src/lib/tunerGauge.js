/**
 * tunerGauge.js — matemática pura del medidor lineal del afinador (sin DOM).
 *
 * Consumido por Tuner.js para posicionar el indicador de la barra de cents.
 */

/**
 * Mapea una desviación en cents a una posición 0..100 sobre la barra lineal.
 * Aplica clamp a [-50, 50]; 0¢ cae en el centro (50).
 * @param {number|null|undefined} cents
 * @returns {number} posición 0..100
 */
export function centsToBarPercent(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return 50;
  const clamped = Math.max(-50, Math.min(50, cents));
  return clamped + 50;
}
