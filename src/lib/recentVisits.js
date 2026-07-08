// recentVisits.js — historial local de canciones visitadas recientemente.
//
// Persiste en localStorage (clave hkn:recent-visits) un array de
// { id, at } ordenado del más reciente al más antiguo, con dedup por id y
// tope de entradas. Se usa para poblar la sección "Reciente" del Home con
// lo que el usuario realmente vio, no solo lo más nuevo del catálogo.

const STORAGE_KEY = 'hkn:recent-visits';
const MAX_ENTRIES = 24;

/**
 * Lee el array crudo de localStorage. Devuelve [] ante cualquier fallo
 * (storage inaccesible, JSON inválido, forma inesperada).
 * @returns {Array<{ id: string, at: number }>}
 */
function readRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.id === 'string');
  } catch (_e) {
    return [];
  }
}

/**
 * Registra la visita a una canción: la mueve al frente del historial
 * (dedup por id) y recorta al tope de entradas. Silencioso ante fallo de
 * localStorage (modo privado de Safari, storage lleno, etc.).
 * @param {string} songId
 */
export function recordVisit(songId) {
  if (!songId) return;
  try {
    const existing = readRaw().filter((entry) => entry.id !== songId);
    const next = [{ id: songId, at: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (_e) {
    // Ignorar: la persistencia de visitas recientes es una mejora, no algo crítico.
  }
}

/**
 * Devuelve los IDs de canciones visitadas, del más reciente al más antiguo.
 * @param {number} [limit=24]
 * @returns {string[]}
 */
export function getRecentVisitIds(limit = 24) {
  return readRaw()
    .slice(0, limit)
    .map((entry) => entry.id);
}
