/**
 * favorites.js — in-memory cache of the signed-in user's favorite song ids.
 *
 * Loads once after login so the song grid can render the heart state without
 * a query per card. Toggle hits Supabase directly via RLS-bound INSERT/DELETE.
 */
import { supabase } from './supabase.js';
import { getSession, subscribe as subscribeAuth } from './authStore.js';

const state = {
  ids: new Set(),
  loaded: false,
  listeners: new Set(),
};

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
    return wasFav;
  }
  return !wasFav;
}

async function loadAll() {
  const session = getSession();
  if (!session) {
    state.ids = new Set();
    state.loaded = false;
    return;
  }
  const { data, error } = await supabase
    .from('favorites')
    .select('song_id')
    .eq('user_id', session.user.id);
  if (error) {
    console.warn('loadFavorites failed', error);
    return;
  }
  state.ids = new Set((data || []).map((r) => r.song_id));
  state.loaded = true;
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
 */
export async function initFavorites() {
  await loadAll();
  subscribeAuth(async ({ session }) => {
    if (!session) {
      state.ids = new Set();
      state.loaded = false;
      notify(null);
      return;
    }
    await loadAll();
    notify(null);
  });
}
