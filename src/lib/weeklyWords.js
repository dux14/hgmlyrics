// src/lib/weeklyWords.js
// Fuente única de weekly-words con SWR (memoria + idb). El endpoint exige
// sesión, así que el fetcher replica el fetch autenticado de los call sites.
import { cached, invalidate, invalidatePrefix, warm } from './prefetch.js';
import { getSession } from './authStore.js';

const KEY = 'weekly-words';
const TTL = 60 * 60 * 1000; // 1h: cambia como mucho semanalmente

async function fetchWeeklyWords() {
  const session = getSession();
  const headers = session ? { Authorization: `Bearer ${session.access_token}` } : {};
  const res = await fetch('/api/weekly-words', { headers });
  if (!res.ok) throw new Error(`fetchWeeklyWords failed: ${res.status}`);
  const jsonBody = await res.json();
  return jsonBody.weeklyWords ?? [];
}

export async function getWeeklyWords() {
  // Un 500/401 transitorio no debe cachearse como "sin voz en off": cached()
  // lanza y cae al stale de mem/idb si lo hay; sin nada previo, propaga.
  try {
    const { data } = await cached(KEY, fetchWeeklyWords, { ttl: TTL });
    return data;
  } catch {
    return [];
  }
}

/**
 * Detalle por id con SWR (memoria + idb): visitada una vez, la voz en off
 * queda disponible offline igual que el listado (H8 auditoría). A diferencia
 * de getWeeklyWords, propaga el error si no hay stale: la vista decide el
 * estado de error.
 * OJO: la respuesta varía por viewer (un admin puede ver un draft que un
 * usuario normal no vería), por eso invalidateWeeklyWords() SIEMPRE debe
 * limpiar también estas keys por id en logout y al guardar/publicar/borrar
 * — de lo contrario un draft cacheado por el admin queda visible para el
 * siguiente usuario del mismo dispositivo, sin pasar por la autorización
 * del servidor.
 * @param {string} id
 */
export async function getWeeklyWord(id) {
  const session = getSession();
  const headers = session ? { Authorization: `Bearer ${session.access_token}` } : {};
  const fetcher = async () => {
    const res = await fetch(`/api/weekly-words/${id}`, { headers });
    if (!res.ok) throw new Error(`getWeeklyWord failed: ${res.status}`);
    return res.json();
  };
  const { data } = await cached(`weekly-word-${id}`, fetcher, { ttl: TTL });
  return data;
}

export function warmWeeklyWords() {
  warm(KEY, fetchWeeklyWords, { ttl: TTL });
}

export function invalidateWeeklyWords() {
  invalidate(KEY);
  // Las keys por id (weekly-word-<id>) también deben caer: su contenido
  // depende del viewer (draft vs publicado) y sobreviven en idb entre
  // sesiones si no se limpian por prefijo. Ver JSDoc de getWeeklyWord.
  invalidatePrefix('weekly-word-');
}
