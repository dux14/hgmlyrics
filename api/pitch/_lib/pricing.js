/**
 * pricing.js — Estimador de costo del pipeline Partitura vocal (puro, sin I/O).
 * `precision` ya NO usa AudioShake: es un perfil OSS de mayor calidad (modelos
 * más pesados → más GPU propio de Modal), sin costo en USD/min cobrado al
 * usuario. F0/notas/fusión/render siguen siendo cómputo propio ($0) según el
 * perfil elegido.
 */
export const RATES = {
  oss: {},
  precision: {},
};

/**
 * @param {'oss'|'precision'} profile
 * @param {number} durationSec
 * @returns {{ lo:number, hi:number, breakdown:{phase:string,cost:number,confirmed:boolean}[] }}
 */
export function estimate(profile, durationSec) {
  if (profile !== 'oss' && profile !== 'precision') {
    const e = new Error(`Perfil desconocido: ${profile}`);
    e.status = 400;
    throw e;
  }
  const breakdown = [];
  breakdown.push({ phase: 'f0+notes+fusion+render', cost: 0, confirmed: true });
  const total = breakdown.reduce((s, b) => s + b.cost, 0);
  // lo = mínimo confiable (fases confirmadas); hi = total incl. estimadas.
  const lo = breakdown.filter((b) => b.confirmed).reduce((s, b) => s + b.cost, 0);
  return { lo, hi: total, breakdown };
}
