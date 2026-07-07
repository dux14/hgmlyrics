// src/lib/searchUsersCache.js
// Cache en memoria de búsquedas de usuarios (admin invitando a una lista):
// evita repetir el mismo query al servidor mientras se edita. TTL 5 min,
// cap 50 entradas (se borra la más vieja al insertar una nueva).
// Vive en módulo propio (en vez de dentro de ListDetail.js) para poder
// limpiarla en SIGNED_OUT sin que authStore importe el componente completo.
const TTL_MS = 5 * 60_000;
const MAX = 50;
const cache = new Map();

/** @param {string} q @param {(q: string) => Promise<any>} fetcher */
export async function cachedSearchUsers(q, fetcher) {
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.results;
  const results = await fetcher(q);
  if (cache.size >= MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(q, { at: Date.now(), results });
  return results;
}

/** Limpia la cache (logout: evita fuga de resultados entre usuarios). */
export function clearSearchUsersCache() {
  cache.clear();
}
