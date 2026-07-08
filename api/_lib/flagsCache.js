// Cache modulo-scope del catálogo de feature flags (global, igual para todos
// los usuarios). TTL corto: en serverless hay N instancias y cada una tiene su
// copia; 10s acota el desfase tras un cambio de flags sin hook de invalidación
// cross-instancia. La instancia que muta invalida al instante vía invalidateFlags().
import sql from './db.js';

const TTL_MS = 10_000;
let cache = null; // { catalog, assignments, ts }

export async function getFlagsCatalog() {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache;
  const [catalog, assignments] = await Promise.all([
    sql`SELECT key, enabled_global AS "enabledGlobal" FROM feature_flags`,
    sql`SELECT flag_key AS "flagKey", email, username FROM feature_flag_users`,
  ]);
  cache = { catalog, assignments, ts: Date.now() };
  return cache;
}

export function invalidateFlags() {
  cache = null;
}
