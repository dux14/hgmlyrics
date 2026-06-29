import sql from './_lib/db.js';

const VALID = new Set(['INP', 'LCP', 'CLS', 'FCP', 'TTFB']);

export function validateVital(b) {
  if (!b || !VALID.has(b.metric)) return false;
  if (typeof b.value !== 'number' || !Number.isFinite(b.value)) return false;
  if (b.value < 0 || b.value > 600000) return false; // rango sano (ms o CLS escalada)
  return true;
}

// Rate-limit en memoria por IP (best-effort; Fluid Compute comparte instancia).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const w = hits.get(ip) || { n: 0, t: now };
  if (now - w.t > 60000) { w.n = 0; w.t = now; }
  w.n += 1;
  hits.set(ip, w);
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
