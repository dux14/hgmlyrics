/**
 * crypto.js — Primitivas de comparación en tiempo constante.
 * Centraliza el patrón timing-safe que antes estaba duplicado en cleanup.js
 * (Bearer del cron) y modal.js (firma HMAC del webhook).
 */
import { timingSafeEqual } from 'node:crypto';

/**
 * Igualdad de strings en tiempo constante (UTF-8). No cortocircuita por longitud
 * de forma que revele el prefijo: si difieren en longitud devuelve false sin
 * comparar byte a byte (la longitud no es secreta). Cadena vacía → false.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
