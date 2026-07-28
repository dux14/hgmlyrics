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
  return (
    globalThis.matchMedia('(display-mode: standalone)').matches ||
    globalThis.navigator.standalone === true
  );
}

/**
 * Start background pre-caching during idle time.
 * Runs for all visitors (not only installed PWA).
 */
export function startBackgroundCache() {
  if (isCaching) return;

  if ('requestIdleCallback' in globalThis) {
    requestIdleCallback(() => ensureSongsCached(), { timeout: 10000 });
  } else {
    // Fallback: wait 3 seconds after load
    setTimeout(() => ensureSongsCached(), 3000);
  }
}

/**
 * Cache songs, revalidando SIEMPRE contra el servidor.
 * prefetchAllSongs ya evita la escritura si data.version coincide con lo
 * cacheado, así que el costo de revalidar en cada boot es solo el fetch
 * (CDN s-maxage 60). Antes retornaba temprano si existía CUALQUIER versión
 * cacheada, dejando el catálogo offline congelado para siempre (H2 auditoría).
 */
export async function ensureSongsCached() {
  if (isCaching) return;
  try {
    const cachedVersion = await get(OFFLINE_VERSION_KEY);
    return prefetchAllSongs(cachedVersion);
  } catch (_) {
    // IndexedDB no disponible (ej. Safari private mode); se reintenta en el próximo boot.
  }
}

async function prefetchAllSongs(cachedVersion) {
  if (isCaching) return;
  isCaching = true;

  try {
    const { fetchWithRetry } = await import('./fetchWithRetry.js');
    const res = await fetchWithRetry('/api/songs/all');
    if (!res.ok) return;

    const data = await res.json();

    // Skip write if server version matches what we already have
    if (cachedVersion && data.version === cachedVersion) return;

    await set(OFFLINE_CACHE_KEY, data.songs);
    await set(OFFLINE_VERSION_KEY, data.version);

    // Notify that caching is complete
    globalThis.dispatchEvent(
      new CustomEvent('offline-cache-ready', {
        detail: { count: data.songs.length },
      }),
    );
  } catch (_) {
    // Retries exhausted (3 attempts with exponential backoff). Next idle will retry.
  } finally {
    isCaching = false;
  }
}

// Re-trigger on reconnect so stale caches get refreshed when coming back online
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('online', () => {
    ensureSongsCached();
  });
}

/**
 * Get a song from offline cache (with sections)
 */
export async function getOfflineSong(id) {
  const songs = await get(OFFLINE_CACHE_KEY);
  return songs?.find((s) => s.id === id) || null;
}

/**
 * Check if a song is available offline
 */
export async function isSongCached(id) {
  const songs = await get(OFFLINE_CACHE_KEY);
  return songs?.some((s) => s.id === id) || false;
}

/**
 * Invalidate offline cache (called on app update)
 */
export async function invalidateOfflineCache() {
  await set(OFFLINE_CACHE_KEY, null);
  await set(OFFLINE_VERSION_KEY, null);
}
