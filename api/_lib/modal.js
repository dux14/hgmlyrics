/**
 * modal.js — Cliente de la app de Modal del Estudio de pistas.
 * Arranca el orquestador DAG y verifica el callback firmado.
 */
import { createHmac } from 'node:crypto';
import { timingSafeEqualStr } from './crypto.js';
import { fetchWithTimeout } from './http.js';

/**
 * Verifica el callback HMAC de Modal: hex(hmac-sha256(`${timestamp}.${body}`)).
 * Anti-replay ±5 min. @returns {boolean}
 */
export function verifyModalSignature({ timestamp, signature, body, secret }) {
  if (!timestamp || !signature || !secret) return false;
  // Fix 3: si timestamp no es numérico, Number() da NaN y `NaN > umbral` es siempre
  // false — el chequeo anti-replay quedaba fail-open. Number.isFinite lo cierra.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > 5 * 60 * 1000) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return timingSafeEqualStr(signature, expected);
}

/**
 * Invoca el orquestador DAG `run_pipeline` en Modal.
 * Payload de nueva generación: el orquestador corre las 4 secciones en paralelo
 * y postea resultados por sección al webhook.
 * @param {{ jobId:string, input:{ getUrl:string }, enabledSections:string[],
 *           uploads:object, webhook:{ url:string, secret:string } }} payload
 * @returns {Promise<{ id:string }>}
 */
export async function invokeModalPipeline(payload) {
  const endpoint = process.env.MODAL_STEMS_ENDPOINT;
  const secret = process.env.MODAL_INBOUND_SECRET;
  if (!endpoint || !secret) {
    const e = new Error('MODAL_STEMS_ENDPOINT / MODAL_INBOUND_SECRET no configurados');
    e.status = 500;
    throw e;
  }
  // Fix 3: timeout < maxDuration de plataforma — si Modal no responde en 8s, fallar rápido
  // con un 502 claro en vez de colgar la función hasta su límite (el caller marca el job
  // failed y conserva su reintento existente).
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inbound-secret': secret },
      body: JSON.stringify({ fn: 'run_pipeline', ...payload }),
    },
    { timeoutMs: 8000, label: 'Modal' },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Modal ${res.status}: ${detail.slice(0, 200)}`);
    e.status = 502;
    throw e;
  }
  return { id: (await res.json()).callId };
}
