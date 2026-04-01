/**
 * store.js — State management & IndexedDB cache
 *
 * Manages song data, filtering, sorting, and persistent offline cache.
 */

import { get, set } from 'idb-keyval';

const CACHE_KEY = 'hkn-songs-cache';
const CACHE_VERSION_KEY = 'hkn-songs-version';
const API_URL = '/api';

/** @type {{ songs: Array, filtered: Array, activeAlbum: string|null, sortMode: string, voiceFilter: string|null }} */
const state = {
  songs: [],
  filtered: [],
  activeAlbum: null,
  sortMode: 'a-z',
  voiceFilter: null,
  listeners: new Set(),
};

/**
 * Subscribe to state changes
 * @param {Function} fn - Callback invoked on state change
 * @returns {Function} Unsubscribe function
 */
export function subscribe(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

function notify() {
  state.listeners.forEach((fn) => fn(getState()));
}

/**
 * Get current state snapshot
 */
export function getState() {
  return {
    songs: state.songs,
    filtered: state.filtered,
    activeAlbum: state.activeAlbum,
    sortMode: state.sortMode,
    voiceFilter: state.voiceFilter,
  };
}

/**
 * Initialize the store — tries API first, then cache
 */
export async function initStore() {
  let loaded = false;
  
  try {
    const res = await fetch(`${API_URL}/songs`);
    if (res.ok) {
      const data = await res.json();
      if (data.songs.length > 0) {
        state.songs = data.songs;
        await set(CACHE_KEY, state.songs);
        loaded = true;
      }
    }
  } catch (e) {
    console.warn('Network offline or backend down, loading from IndexedDB');
  }

  if (!loaded) {
    try {
      const cached = await get(CACHE_KEY);
      if (cached && Array.isArray(cached)) {
        state.songs = cached;
      }
    } catch (_e) {
      // IndexedDB unavailable
    }
  }

  applyFilters();
  notify();
}

/**
 * Refresh data from API and update cache
 */
export async function refreshData() {
  try {
    const res = await fetch(`${API_URL}/songs`);
    if (res.ok) {
      const data = await res.json();
      if (data.songs.length > 0) {
        state.songs = data.songs;
        await set(CACHE_KEY, state.songs);
      }
    }
  } catch (e) {
    console.warn('Could not refresh data from network');
  }
  applyFilters();
  notify();
}

/**
 * Get unique albums from all songs
 * @returns {Array<{slug: string, name: string, coverImage: string}>}
 */
export function getAlbums() {
  const albumMap = new Map();
  state.songs.forEach((song) => {
    if (!albumMap.has(song.albumSlug)) {
      albumMap.set(song.albumSlug, {
        slug: song.albumSlug,
        name: song.album,
        coverImage: song.coverImage,
      });
    }
  });
  return Array.from(albumMap.values());
}

export function getVoiceTypes() {
  // Always return the main voice types regardless of whether songs currently use them
  return ['male', 'female', 'mixed'];
}

/**
 * Get a song by ID
 * @param {string} id
 * @returns {object|undefined}
 */
export function getSongById(id) {
  return state.songs.find((s) => s.id === id);
}

/**
 * Fetch full song detail (with sections) from the API
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function fetchSongDetail(id) {
  try {
    const res = await fetch(`${API_URL}/songs/${id}`);
    if (res.ok) {
      const song = await res.json();
      // Update the song in the local state with sections
      const idx = state.songs.findIndex((s) => s.id === id);
      if (idx !== -1) {
        state.songs[idx] = { ...state.songs[idx], ...song };
      }
      return song;
    }
  } catch (e) {
    console.warn('Could not fetch song detail:', e);
    // F8: Fallback — try offline cache
    try {
      const { getOfflineSong } = await import('./offlineCache.js');
      const cached = await getOfflineSong(id);
      if (cached) return cached;
    } catch (_) {
      // offlineCache not available
    }
  }
  return null;
}

/**
 * Filter by album
 * @param {string|null} albumSlug - null to clear filter
 */
export function filterByAlbum(albumSlug) {
  state.activeAlbum = albumSlug;
  if (albumSlug) {
    state.sortMode = 'album-order';
  } else if (state.sortMode === 'album-order') {
    state.sortMode = 'a-z';
  }
  applyFilters();
  notify();
}

/**
 * Set sort mode
 * @param {'a-z'|'z-a'|'recent'|'album'} mode
 */
export function setSortMode(mode) {
  state.sortMode = mode;
  applyFilters();
  notify();
}

/**
 * Filter by voice type
 * @param {string|null} voiceType - 'male', 'female', 'mixed', or null
 */
export function filterByVoice(voiceType) {
  state.voiceFilter = voiceType;
  applyFilters();
  notify();
}

/**
 * Apply all active filters and sorting
 */
function applyFilters() {
  let result = [...state.songs];

  // Album filter
  if (state.activeAlbum) {
    result = result.filter((s) => s.albumSlug === state.activeAlbum);
  }

  // Voice filter
  if (state.voiceFilter) {
    result = result.filter((s) => s.voiceType === state.voiceFilter);
  }

  // Sorting
  switch (state.sortMode) {
    case 'a-z':
      result.sort((a, b) => a.title.localeCompare(b.title, 'es'));
      break;
    case 'z-a':
      result.sort((a, b) => b.title.localeCompare(a.title, 'es'));
      break;
    case 'recent':
      result.sort((a, b) => (b.year || 0) - (a.year || 0) || (b.albumOrder || 0) - (a.albumOrder || 0));
      break;
    case 'album':
      result.sort((a, b) => a.album.localeCompare(b.album, 'es') || (a.albumOrder || 0) - (b.albumOrder || 0) || a.title.localeCompare(b.title, 'es'));
      break;
    case 'album-order':
      result.sort((a, b) => (a.albumOrder || 0) - (b.albumOrder || 0));
      break;
  }

  state.filtered = result;
}

/**
 * Get previous and next songs in the same album (circular navigation)
 * @param {string} songId
 * @returns {{ prev: object|null, next: object|null, currentIndex: number, total: number }}
 */
export function getAdjacentSongs(songId) {
  const song = state.songs.find(s => s.id === songId);
  if (!song || !song.albumSlug) return { prev: null, next: null, currentIndex: -1, total: 0 };

  const albumSongs = state.songs
    .filter(s => s.albumSlug === song.albumSlug)
    .sort((a, b) => (a.albumOrder || 0) - (b.albumOrder || 0));

  if (albumSongs.length <= 1) return { prev: null, next: null, currentIndex: 0, total: albumSongs.length };

  const idx = albumSongs.findIndex(s => s.id === songId);
  // Circular: wrap around
  const prevIdx = (idx - 1 + albumSongs.length) % albumSongs.length;
  const nextIdx = (idx + 1) % albumSongs.length;

  return {
    prev: albumSongs[prevIdx],
    next: albumSongs[nextIdx],
    currentIndex: idx,
    total: albumSongs.length,
  };
}

/**
 * Clear IndexedDB cache
 */
export async function clearCache() {
  try {
    await set(CACHE_KEY, null);
    await set(CACHE_VERSION_KEY, null);
  } catch (_e) {
    // Ignore
  }
}
