/**
 * hmac.js — Verificación del callback firmado Modal(hkn-pitch)→Vercel.
 * hex(hmac-sha256(`${timestamp}.${body}`)), anti-replay ±5 min. Propio del
 * pipeline Partitura (usa PITCH_MODAL_WEBHOOK_SECRET, no el del Estudio).
 */
import { createHmac } from 'node:crypto';
import { timingSafeEqualStr } from '../../_lib/crypto.js';

export function verifyPitchSignature({ timestamp, signature, body, secret }) {
  if (!timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > 5 * 60 * 1000) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return timingSafeEqualStr(signature, expected);
}
