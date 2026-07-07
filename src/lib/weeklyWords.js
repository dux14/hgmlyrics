// src/lib/weeklyWords.js
// Fuente única de weekly-words con SWR (memoria + idb). El endpoint exige
// sesión, así que el fetcher replica el fetch autenticado de los call sites.
import { cached, invalidate, warm } from './prefetch.js';
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

export function warmWeeklyWords() {
  warm(KEY, fetchWeeklyWords, { ttl: TTL });
}

export function invalidateWeeklyWords() {
  invalidate(KEY);
}
