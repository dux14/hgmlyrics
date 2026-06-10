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

/**
 * Arranca un modelo en Modal. `input.audio` es la signed URL del audio fuente.
 * @param {{ kind:string, input:object, jobId:string, userId:string, callbackUrl:string }} args
 * @returns {Promise<{ id:string }>}
 */
export async function createModalJob({ kind, input, jobId, userId, callbackUrl }) {
  const endpoint = process.env.MODAL_STEMS_ENDPOINT;
  const secret = process.env.MODAL_INBOUND_SECRET;
  if (!endpoint || !secret) {
    const e = new Error('MODAL_STEMS_ENDPOINT / MODAL_INBOUND_SECRET no configurados');
    e.status = 500;
    throw e;
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-inbound-secret': secret },
    body: JSON.stringify({ kind, audioUrl: input.audio, jobId, userId, callbackUrl }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Modal ${res.status}: ${detail.slice(0, 200)}`);
    e.status = 502;
    throw e;
  }
  return { id: (await res.json()).callId };
}
