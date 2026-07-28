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
    // El objeto completo (no solo `.target`) viaja entero a sql.json(...): sin
    // este tope, un cliente puede mandar attribution.junk arbitrariamente
    // grande (confirmado en vivo: 2MB → fila de 2.097.186 bytes en web_vitals,
    // endpoint sin auth). 2048 alcanza de sobra al shape real de web-vitals
    // (target + rects + IDs cortos).
    if (JSON.stringify(b.attribution).length > 2048) return false;
  }
  return true;
}

// Rate-limit en memoria por IP (best-effort; Fluid Compute comparte instancia).
// La clave es x-forwarded-for, que el cliente puede falsificar (no hay upstream
// confiable que la fije) — no es una barrera de seguridad, es mitigación de
// costo/ruido para el caso común de un cliente descontrolado. El tope real
// contra payloads maliciosos es el límite de tamaño de arriba + el cron de
// purga (api/vitals/cleanup.js).
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
