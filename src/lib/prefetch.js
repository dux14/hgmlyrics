// src/lib/prefetch.js
// Cache SWR mínima (memoria + idb como respaldo offline) y warm-up en idle.
import { get, set, del, keys } from 'idb-keyval';

const TTL_MS = 60_000; // frescura en memoria
const mem = new Map(); // key -> { data, ts }
// B7 (perf): dedup de peticiones en vuelo — sin esto, N consumidores de la
// misma key (p. ej. weekly-words) disparaban N fetches concurrentes idénticos.
const inFlight = new Map(); // key -> Promise<{data, fromCache}>

async function idbGet(key) {
  try {
    return await get(`prefetch:${key}`);
  } catch {
    return undefined;
  }
}
function idbSet(key, data) {
  Promise.resolve()
    .then(() => set(`prefetch:${key}`, data))
    .catch(() => {}); // jsdom / sin IndexedDB: degradar a memoria
}
function idbDel(key) {
  Promise.resolve()
    .then(() => del(`prefetch:${key}`))
    .catch(() => {});
}

/** Lectura síncrona de memoria (para pintar al instante). undefined si no hay. */
export function readCached(key) {
  return mem.get(key)?.data;
}

/** Vacía la cache (solo para tests). */
export function _clearCache() {
  mem.clear();
  inFlight.clear();
}

/** Invalida una key: borra memoria + idb para forzar refetch en la próxima lectura. */
export function invalidate(key) {
  mem.delete(key);
  idbDel(key);
}

/**
 * Invalida todas las keys que empiecen con `prefix` (memoria + idb).
 * Útil cuando no se conoce el listado exacto de keys (p. ej. profile:<username>
 * por cada perfil visitado) y hay que purgarlas todas de una — típicamente en
 * logout, para no dejar datos calculados para un viewer visibles al siguiente.
 * @param {string} prefix
 */
export function invalidatePrefix(prefix) {
  for (const key of mem.keys()) {
    if (key.startsWith(prefix)) mem.delete(key);
  }
  Promise.resolve()
    .then(async () => {
      const allKeys = await keys();
      const stale = allKeys.filter(
        (k) => typeof k === 'string' && k.startsWith(`prefetch:${prefix}`),
      );
      await Promise.all(stale.map((k) => del(k)));
    })
    .catch(() => {}); // jsdom / sin IndexedDB: degradar a memoria
}

/**
 * Datos con estrategia stale-while-revalidate.
 * @param {string} key
 * @param {() => Promise<any>} fetcher
 * @param {{ttl?:number}} [opts]
 * @returns {Promise<{data:any, fromCache:boolean}>}
 */
export async function cached(key, fetcher, { ttl = TTL_MS } = {}) {
  const entry = mem.get(key);
  if (entry && Date.now() - entry.ts < ttl) return { data: entry.data, fromCache: true };

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const data = await fetcher();
      mem.set(key, { data, ts: Date.now() });
      idbSet(key, data);
      return { data, fromCache: false };
    } catch (err) {
      const fallback = entry?.data ?? (await idbGet(key));
      if (fallback !== undefined) return { data: fallback, fromCache: true };
      throw err;
    }
  })();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Precalienta una key en idle si no está fresca. Fire-and-forget.
 * @param {string} key
 * @param {() => Promise<any>} fetcher
 * @param {{ttl?:number}} [opts]
 */
export function warm(key, fetcher, { ttl = TTL_MS } = {}) {
  const entry = mem.get(key);
  if (entry && Date.now() - entry.ts < ttl) return;
  const run = () => cached(key, fetcher, { ttl }).catch(() => {});
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 0);
}
