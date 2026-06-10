/**
 * replicate.js — Cliente mínimo de la REST API de Replicate (sin SDK).
 * Docs: https://replicate.com/docs/topics/webhooks/verify-webhook
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.replicate.com/v1';

function authHeaders() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    const e = new Error('REPLICATE_API_TOKEN no configurado');
    e.status = 500;
    throw e;
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function replicateFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...authHeaders(), ...opts.headers } });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Replicate ${res.status}: ${detail.slice(0, 200)}`);
    e.status = 502;
    throw e;
  }
  return res.json();
}

/**
 * Crea una predicción contra la última versión del modelo.
 * @param {{ model: string, input: object, webhook: string }} args
 */
export async function createPrediction({ model, input, webhook }) {
  return replicateFetch(`${API}/models/${model}/predictions`, {
    method: 'POST',
    body: JSON.stringify({ input, webhook, webhook_events_filter: ['completed'] }),
  });
}

/** @param {string} id */
export async function getPrediction(id) {
  return replicateFetch(`${API}/predictions/${id}`);
}

/**
 * Verifica la firma svix-style de un webhook de Replicate.
 * signatures: "v1,<base64> v1,<base64>..." — válida si ALGUNA coincide.
 * @returns {boolean}
 */
export function verifyWebhookSignature({ id, timestamp, signatures, body, secret }) {
  if (!id || !timestamp || !signatures || !secret) return false;
  const key = Buffer.from(secret.split('_')[1] ?? '', 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(' ').some((entry) => {
    const sig = entry.split(',')[1];
    if (!sig) return false;
    const candidate = Buffer.from(sig, 'base64');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
