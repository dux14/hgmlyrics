/**
 * interpolation.js — Buffer de interpolación de posición para peers remotos.
 *
 * Cada posición recibida se almacena con su timestamp. Al renderizar, se llama
 * sample(now) que retrocede `delayMs` en el tiempo y hace lerp entre las dos
 * muestras que rodean ese instante, suavizando el movimiento de red.
 */

/**
 * @typedef {{ x: number, y: number, t: number }} Sample
 */

export class PeerBuffer {
  /**
   * @param {{ delayMs: number }} opts
   */
  constructor({ delayMs }) {
    /** @type {number} */
    this.delayMs = delayMs;
    /** @type {Sample[]} cola ordenada por t ascendente */
    this._samples = [];
  }

  /**
   * Añade una muestra al buffer (se asume que llegan en orden creciente de t).
   * @param {Sample} sample
   */
  push(sample) {
    this._samples.push(sample);
  }

  /**
   * Devuelve la posición interpolada para el instante `now`.
   * El punto de referencia efectivo es `now - delayMs`.
   * @param {number} now  — timestamp de render (ms)
   * @returns {{ x: number, y: number } | null}
   */
  sample(now) {
    const q = this._samples;
    if (q.length === 0) return null;

    const target = now - this.delayMs;

    // target está antes o en la muestra más antigua → devolver la primera
    if (target <= q[0].t) {
      return { x: q[0].x, y: q[0].y };
    }

    // target está en o después de la muestra más reciente → devolver la última
    if (target >= q[q.length - 1].t) {
      const last = q[q.length - 1];
      return { x: last.x, y: last.y };
    }

    // Buscar las dos muestras que rodean a target
    let lo = 0;
    for (let i = 0; i < q.length - 1; i++) {
      if (q[i].t <= target && target < q[i + 1].t) {
        lo = i;
        break;
      }
    }
    const s0 = q[lo];
    const s1 = q[lo + 1];
    const alpha = (target - s0.t) / (s1.t - s0.t);

    // Podar muestras anteriores a s0 (ya no se necesitarán)
    if (lo > 0) {
      this._samples = q.slice(lo);
    }

    return {
      x: s0.x + (s1.x - s0.x) * alpha,
      y: s0.y + (s1.y - s0.y) * alpha,
    };
  }
}
