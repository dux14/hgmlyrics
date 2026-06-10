/**
 * modal.js — Cliente de la app de Modal del Estudio de pistas.
 * Espeja el rol de replicate.js: arrancar jobs y verificar el callback firmado.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica el callback HMAC de Modal: hex(hmac-sha256(`${timestamp}.${body}`)).
 * Anti-replay ±5 min. @returns {boolean}
 */
export function verifyModalSignature({ timestamp, signature, body, secret }) {
  if (!timestamp || !signature || !secret) return false;
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
