/**
 * offlineCache.js — Background song pre-caching for PWA
 *
 * Uses requestIdleCallback to download all songs during idle time.
 * Stores full song data (with sections) in IndexedDB.
 */
import { get, set } from 'idb-keyval';

const OFFLINE_CACHE_KEY = 'hkn-offline-songs';
const OFFLINE_VERSION_KEY = 'hkn-offline-version';

let isCaching = false;

/**
 * Check if running as installed PWA
 */
export function isPWA() {
  return globalThis.matchMedia('(display-mode: standalone)').matches
    || globalThis.navigator.standalone === true;
}

/**
 * Start background pre-caching during idle time
 */
export function startBackgroundCache() {
  if (!isPWA() || isCaching) return;

  if ('requestIdleCallback' in globalThis) {
    requestIdleCallback(() => prefetchAllSongs(), { timeout: 10000 });
  } else {
    // Fallback: wait 3 seconds after load
    setTimeout(() => prefetchAllSongs(), 3000);
  }
}

async function prefetchAllSongs() {
  if (isCaching) return;
  isCaching = true;

  try {
    const res = await fetch('/api/songs/all');
    if (!res.ok) return;

    const data = await res.json();
    await set(OFFLINE_CACHE_KEY, data.songs);
    await set(OFFLINE_VERSION_KEY, data.version);

    // Notify that caching is complete
    globalThis.dispatchEvent(new CustomEvent('offline-cache-ready', {
      detail: { count: data.songs.length }
    }));
  } catch (_) {
    // Offline or failed — will retry on next idle
  } finally {
    isCaching = false;
  }
}

/**
 * Get a song from offline cache (with sections)
 */
export async function getOfflineSong(id) {
  const songs = await get(OFFLINE_CACHE_KEY);
  return songs?.find(s => s.id === id) || null;
}

/**
 * Check if a song is available offline
 */
export async function isSongCached(id) {
  const songs = await get(OFFLINE_CACHE_KEY);
  return songs?.some(s => s.id === id) || false;
}

/**
 * Invalidate offline cache (called on app update)
 */
export async function invalidateOfflineCache() {
  await set(OFFLINE_CACHE_KEY, null);
  await set(OFFLINE_VERSION_KEY, null);
}
