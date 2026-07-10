// recentVisits.js — historial de canciones visitadas recientemente, ligado a la cuenta.
//
// Con sesión, la fuente de verdad es la tabla recent_visits en Supabase:
// cada visita hace upsert y al iniciar sesión se fusiona el historial local
// con el del servidor (gana el timestamp más reciente por canción).
// localStorage (clave hkn:recent-visits) sigue siendo el cache de lectura
// —array de { id, at } del más reciente al más antiguo— para que el Home
// renderice síncrono y para invitados / boot offline.

import { supabase } from './supabase.js';
import { getSession, subscribe as subscribeAuth } from './authStore.js';

const STORAGE_KEY = 'hkn:recent-visits';
const MAX_ENTRIES = 24;

// Generación de sync: se incrementa en cada transición de sesión para que un
// syncFromServer en vuelo no escriba el historial de una cuenta anterior
// después de un sign-out/cambio de cuenta (dispositivos compartidos).
let syncEpoch = 0;

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
 * Escribe el historial en localStorage. Silencioso ante fallo (modo privado
 * de Safari, storage lleno, etc.): la persistencia local es una mejora.
 * @param {Array<{ id: string, at: number }>} entries
 */
function writeRaw(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (_e) {
    // Ignorar.
  }
}

/**
 * Registra la visita a una canción: la mueve al frente del historial local
 * (dedup por id, tope de entradas) y, si hay sesión, la sube a Supabase en
 * segundo plano (fire-and-forget). Nunca lanza: el historial es una mejora,
 * no algo crítico. Una subida fallida se recupera en el próximo merge de
 * initRecentVisits mientras la entrada siga en el cache local.
 * @param {string} songId
 */
export function recordVisit(songId) {
  if (!songId) return;
  const at = Date.now();
  const existing = readRaw().filter((entry) => entry.id !== songId);
  writeRaw([{ id: songId, at }, ...existing].slice(0, MAX_ENTRIES));

  try {
    const session = getSession();
    if (!session) return;
    supabase
      .from('recent_visits')
      .upsert(
        { user_id: session.user.id, song_id: songId, visited_at: new Date(at).toISOString() },
        { onConflict: 'user_id,song_id' },
      )
      .then(
        ({ error }) => {
          if (error) console.warn('recordVisit sync failed', error);
        },
        (e) => console.warn('recordVisit sync failed', e),
      );
  } catch (e) {
    console.warn('recordVisit sync failed', e);
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

/**
 * Sincroniza con el servidor: baja el historial de la cuenta, lo fusiona con
 * el local (por canción gana el timestamp más reciente), persiste el resultado
 * en localStorage y sube las entradas locales ausentes o más nuevas.
 * Nunca rechaza; ante fallo deja el historial local intacto.
 */
async function syncFromServer() {
  const epoch = syncEpoch;
  const session = getSession();
  if (!session) return;
  try {
    const { data, error } = await supabase
      .from('recent_visits')
      .select('song_id, visited_at')
      .eq('user_id', session.user.id)
      .order('visited_at', { ascending: false })
      .limit(MAX_ENTRIES);
    if (error) {
      console.warn('loadRecentVisits failed', error);
      return;
    }
    // La sesión cambió mientras esperábamos: descartar este sync.
    if (epoch !== syncEpoch) return;

    const merged = new Map(
      (data || []).map((row) => [row.song_id, Date.parse(row.visited_at) || 0]),
    );
    const toPush = [];
    for (const entry of readRaw()) {
      const at = typeof entry.at === 'number' ? entry.at : 0;
      if (!merged.has(entry.id) || at > merged.get(entry.id)) {
        merged.set(entry.id, at);
        toPush.push({
          user_id: session.user.id,
          song_id: entry.id,
          visited_at: new Date(at).toISOString(),
        });
      }
    }

    writeRaw(
      [...merged.entries()]
        .map(([id, at]) => ({ id, at }))
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_ENTRIES),
    );

    if (toPush.length && epoch === syncEpoch) {
      const { error: pushError } = await supabase
        .from('recent_visits')
        .upsert(toPush, { onConflict: 'user_id,song_id' });
      if (pushError) console.warn('pushRecentVisits failed', pushError);
    }
  } catch (e) {
    console.warn('syncRecentVisits failed', e);
  }
}

/**
 * Bootstrap del historial: se suscribe a auth ANTES del sync inicial (para no
 * perder una transición durante el await, p. ej. pendingSession resolviendo
 * en boot offline) y luego sincroniza si hay sesión. Reacciona a los cambios
 * de auth — merge al iniciar sesión, limpieza del cache local al cerrarla
 * (separación de cuentas en dispositivos compartidos). Los snapshots sin
 * transición (boot de invitado, refresh de token) no tocan el historial.
 */
export async function initRecentVisits() {
  let hadSession = !!getSession();
  subscribeAuth(({ session }) => {
    const hasSession = !!session;
    if (hasSession !== hadSession) syncEpoch++;
    if (hasSession && !hadSession) syncFromServer();
    if (!hasSession && hadSession) writeRaw([]);
    hadSession = hasSession;
  });
  await syncFromServer();
}
