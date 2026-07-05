/**
 * pricing.js — Estimador de costo del pipeline Partitura vocal (puro, sin I/O).
 * F0/notas/fusión/render son cómputo propio (costo de GPU Modal, no cobrado al
 * usuario aquí → 0). En `precision`, AudioShake cubre separación + letra en un
 * job y se cobra por minuto de audio (redondeo hacia arriba).
 */
export const RATES = {
  oss: {},
  precision: {
    // USD por minuto de audio (tarifa de referencia; ajustar con rates reales).
    audioshake_per_min: 0.05,
  },
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
  const minutes = Math.max(1, Math.ceil((Number(durationSec) || 0) / 60));
  const breakdown = [];
  if (profile === 'precision') {
    const cost = minutes * RATES.precision.audioshake_per_min;
    breakdown.push({ phase: 'separation+lyrics', cost, confirmed: false });
  }
  breakdown.push({ phase: 'f0+notes+fusion+render', cost: 0, confirmed: true });
  const total = breakdown.reduce((s, b) => s + b.cost, 0);
  // lo = mínimo confiable (fases confirmadas); hi = total incl. estimadas.
  const lo = breakdown.filter((b) => b.confirmed).reduce((s, b) => s + b.cost, 0);
  return { lo, hi: total, breakdown };
}
