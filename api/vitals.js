import sql from './_lib/db.js';

const VALID = new Set(['INP', 'LCP', 'CLS', 'FCP', 'TTFB']);

// Campo opcional: ausente/null, o string acotada. Evita que postgres.js
// serialice objetos como '[object Object]' o que entren strings gigantes a la DB.
function optStr(v, max) {
  return v == null || (typeof v === 'string' && v.length <= max);
}

export function validateVital(b) {
  if (!b || !VALID.has(b.metric)) return false;
  if (typeof b.value !== 'number' || !Number.isFinite(b.value)) return false;
  if (b.value < 0 || b.value > 600000) return false; // rango sano (ms o CLS escalada)
  if (!optStr(b.rating, 32)) return false; // p.ej. 'needs-improvement'
  if (!optStr(b.navigationType, 32)) return false;
  if (!optStr(b.path, 512)) return false;
  if (b.attribution != null) {
    if (typeof b.attribution !== 'object') return false;
    if (!optStr(b.attribution.target, 512)) return false;
  }
  return true;
}

// Rate-limit en memoria por IP (best-effort; Fluid Compute comparte instancia).
const hits = new Map();
const MAX_TRACKED = 10000;
function rateLimited(ip) {
  const now = Date.now();
  const w = hits.get(ip);
  if (!w || now - w.t > 60000) {
    // Ventana nueva. Acota memoria: barre ventanas expiradas si el Map crecio
    // de mas (IPs unicas que nunca regresan no deben acumularse sin limite).
    if (hits.size > MAX_TRACKED) {
      for (const [k, v] of hits) {
        if (now - v.t > 60000) hits.delete(k);
      }
    }
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  w.n += 1;
  return w.n > 60; // 60 req/min por IP
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) { res.status(429).end(); return; }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { res.status(400).end(); return; }
  }

  if (!validateVital(body)) { res.status(400).end(); return; }

  try {
    await sql`
      insert into web_vitals (metric, value, rating, navigation_type, path, attribution, ua)
      values (
        ${body.metric},
        ${body.value},
        ${body.rating ?? null},
        ${body.navigationType ?? null},
        ${body.path ?? null},
        ${body.attribution ? sql.json(body.attribution) : null},
        ${req.headers['user-agent'] ?? null}
      )
    `;
    res.status(204).end();
  } catch {
    // Nunca exponer errores de DB al beacon
    res.status(204).end();
  }
}
