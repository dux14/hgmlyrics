/**
 * favorites.js — in-memory cache of the signed-in user's favorite song ids.
 *
 * Loads once after login so the song grid can render the heart state without
 * a query per card. Toggle hits Supabase directly via RLS-bound INSERT/DELETE.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { supabase } from './supabase.js';
import { getSession, isPendingSession, subscribe as subscribeAuth } from './authStore.js';
import { showToast } from './toast.js';

const FAVORITES_CACHE_KEY = 'hkn-favorites';

const state = {
  ids: new Set(),
  loaded: false,
  listeners: new Set(),
};

// Generación de sync (espejo de recentVisits.js): se incrementa en cada
// transición de sesión para que un loadAll en vuelo no pise el estado de una
// cuenta distinta después de un logout/cambio de cuenta (dispositivos
// compartidos).
let syncEpoch = 0;

function notify(songId) {
  state.listeners.forEach((fn) => fn(songId));
}

/**
 * Subscribe to favorite changes. The callback receives the toggled song id.
 * @param {(songId: string) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

/**
 * @param {string} songId
 * @returns {boolean}
 */
export function isFavorite(songId) {
  return state.ids.has(songId);
}

/**
 * Toggle favorite state. Optimistic local update, reverts on error.
 * @param {string} songId
 * @returns {Promise<boolean>} new state (true = favorited)
 */
export async function toggleFavorite(songId) {
  const session = getSession();
  if (!session) return false;
  const userId = session.user.id;
  const wasFav = state.ids.has(songId);

  if (wasFav) state.ids.delete(songId);
  else state.ids.add(songId);
  notify(songId);

  const { error } = wasFav
    ? await supabase.from('favorites').delete().eq('user_id', userId).eq('song_id', songId)
    : await supabase.from('favorites').insert({ user_id: userId, song_id: songId });

  if (error) {
    if (wasFav) state.ids.add(songId);
    else state.ids.delete(songId);
    notify(songId);
    console.warn('toggleFavorite failed', error);
    showToast('No se pudo guardar el favorito. Revisa tu conexión.', { type: 'error' });
    return wasFav;
  }
  try {
    await idbSet(FAVORITES_CACHE_KEY, [...state.ids]);
  } catch (_e) {
    /* idb no disponible */
  }
  return !wasFav;
}

async function loadAll() {
  const epoch = syncEpoch;
  const session = getSession();
  if (!session) {
    if (isPendingSession()) {
      // Boot offline con refresh token persistido pero sin access_token
      // todavía (T1 de authStore): es el caso primario de H5, no un logout.
      // Restaurar el último snapshot local en vez de mostrar "sin
      // favoritos" falso.
      try {
        const cached = await idbGet(FAVORITES_CACHE_KEY);
        if (epoch !== syncEpoch) return;
        if (Array.isArray(cached)) {
          state.ids = new Set(cached);
          state.loaded = true;
        }
      } catch (_e) {
        /* idb no disponible */
      }
      return;
    }
    state.ids = new Set();
    state.loaded = false;
    return;
  }
  const { data, error } = await supabase
    .from('favorites')
    .select('song_id')
    .eq('user_id', session.user.id);
  if (epoch !== syncEpoch) return;
  if (error) {
    console.warn('loadFavorites failed', error);
    // Cubre cualquier error de la query (offline, RLS, etc.): restaurar el
    // último snapshot local en vez de mostrar "sin favoritos" falso (H5).
    try {
      const cached = await idbGet(FAVORITES_CACHE_KEY);
      if (epoch !== syncEpoch) return;
      if (Array.isArray(cached) && state.ids.size === 0) {
        state.ids = new Set(cached);
        state.loaded = true;
      }
    } catch (_e) {
      /* idb no disponible */
    }
    return;
  }
  state.ids = new Set((data || []).map((r) => r.song_id));
  state.loaded = true;
  try {
    await idbSet(FAVORITES_CACHE_KEY, [...state.ids]);
  } catch (_e) {
    /* idb no disponible */
  }
}

/**
 * Devuelve un array con los IDs de canciones marcadas como favoritas.
 * @returns {string[]}
 */
export function getFavoriteIds() {
  return [...state.ids];
}

/**
 * Solo para tests: reemplaza el conjunto de IDs de favoritos en el estado
 * interno. No invocar en código de producción.
 * @param {string[]} ids
 */
export function _setFavoriteIds(ids) {
  state.ids = new Set(ids);
}

/**
 * Bootstrap favorites cache and re-load on sign-in / clear on sign-out.
 * Se suscribe a auth ANTES del load inicial (espejo de recentVisits.js: para
 * no perder una transición durante el await, p. ej. pendingSession
 * resolviendo en boot offline) y sube la época de sync en cada transición
 * para que un loadAll en vuelo no pise el estado de una cuenta distinta.
 */
export async function initFavorites() {
  let hadSession = !!getSession();
  subscribeAuth(async ({ session }) => {
    const hasSession = !!session;
    if (hasSession !== hadSession) syncEpoch++;
    hadSession = hasSession;
    if (!session) {
      state.ids = new Set();
      state.loaded = false;
      try {
        await idbSet(FAVORITES_CACHE_KEY, null);
      } catch (_e) {
        /* idb no disponible */
      }
      notify(null);
      return;
    }
    await loadAll();
    notify(null);
  });
  await loadAll();
}
