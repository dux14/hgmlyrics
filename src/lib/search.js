/**
 * search.js — Accent & case insensitive song search
 *
 * Uses normalized substring matching on title, album, artist.
 * Precise results with Spanish accent support.
 */

/** @type {Array} */
let songList = [];

/** @type {Array} */
let weeklyWordList = [];

/**
 * Normalize text: strip accents + lowercase for accent-insensitive comparison
 * @param {string} str
 * @returns {string}
 */
export function normalize(str) {
  return str
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Build the search index from songs and optional weekly_words.
 * Backward-compatible: buildIndex(songs) still works.
 * @param {Array} songs
 * @param {Array} [weeklyWords]
 */
export function buildIndex(songs, weeklyWords = []) {
  songList = songs;
  weeklyWordList = weeklyWords;
}

/**
 * Search for songs matching a query
 * @param {string} query - Search term
 * @param {number} [limit=10] - Max results
 * @returns {Array} Matched songs ranked by relevance
 */
export function searchSongs(query, limit = 10) {
  if (!query?.trim()) {
    return [];
  }

  const normalizedQuery = normalize(query.trim());

  // Score each song based on where the match is found
  const scored = [];

  for (const song of songList) {
    const normalizedTitle = normalize(song.title || '');
    const normalizedAlbum = normalize(song.album || '');
    const normalizedArtist = normalize(song.artist || '');

    let score = 0;

    // Title match (highest priority)
    if (normalizedTitle.includes(normalizedQuery)) {
      score += 100;
      // Bonus for starts-with match
      if (normalizedTitle.startsWith(normalizedQuery)) {
        score += 50;
      }
    }

    // Album match
    if (normalizedAlbum.includes(normalizedQuery)) {
      score += 30;
    }

    // Artist match
    if (normalizedArtist.includes(normalizedQuery)) {
      score += 10;
    }

    if (score > 0) {
      scored.push({ song, score });
    }
  }

  // Sort by score descending, then alphabetically by title
  scored.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title, 'es'));

  return scored.slice(0, limit).map((s) => s.song);
}

/**
 * Search songs AND weekly_words matching a query.
 * Returns array of { type: 'song'|'weekly_word', item, score }.
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {Array<{ type: string, item: object, score: number }>}
 */
export function searchAll(query, limit = 10) {
  if (!query?.trim()) return [];
  const q = normalize(query.trim());
  const scored = [];

  for (const song of songList) {
    let score = 0;
    const t = normalize(song.title || '');
    const al = normalize(song.album || '');
    const ar = normalize(song.artist || '');
    if (t.includes(q)) {
      score += 100;
      if (t.startsWith(q)) score += 50;
    }
    if (al.includes(q)) score += 30;
    if (ar.includes(q)) score += 10;
    if (score > 0) scored.push({ type: 'song', item: song, score });
  }

  for (const ww of weeklyWordList) {
    let score = 0;
    const ref = normalize(ww.gospel_ref || '');
    const searchTitle = normalize(ww.title || '');
    const litTitle = normalize(ww.liturgical_title || '');
    const body = normalize(ww.voiceover_body || '');
    if (searchTitle.includes(q)) {
      score += 120;
      if (searchTitle.startsWith(q)) score += 50;
    }
    if (ref.includes(q)) {
      score += 100;
      if (ref.startsWith(q)) score += 50;
    }
    if (litTitle.includes(q)) score += 60;
    if (body.includes(q)) score += 20;
    if (score > 0) scored.push({ type: 'weekly_word', item: ww, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Clear the search index (songs + weekly words).
 */
export function clearIndex() {
  songList = [];
  weeklyWordList = [];
}

/**
 * Busqueda unificada seccionada: canciones, albumes (dedupe por slug) y voces en off.
 * @param {string} query
 * @param {{ songs?: number, albums?: number, voces?: number }} [limits]
 * @returns {{ songs: Array, albums: Array, voces: Array }}
 */
export function searchEverything(query, limits = {}) {
  const empty = { songs: [], albums: [], voces: [] };
  if (!query?.trim()) return empty;
  const q = normalize(query.trim());
  const { songs: sL = 20, albums: aL = 8, voces: vL = 6 } = limits;

  const songs = searchSongs(query, sL);

  const albumMap = new Map();
  for (const song of songList) {
    if (!song.albumSlug || albumMap.has(song.albumSlug)) continue;
    if (normalize(song.album || '').includes(q)) {
      albumMap.set(song.albumSlug, {
        slug: song.albumSlug,
        name: song.album,
        coverImage: song.coverImage,
      });
    }
  }
  const albums = Array.from(albumMap.values()).slice(0, aL);

  const voces = [];
  for (const ww of weeklyWordList) {
    const t = normalize(ww.title || '');
    const ref = normalize(ww.gospel_ref || '');
    const lit = normalize(ww.liturgical_title || '');
    if (t.includes(q) || ref.includes(q) || lit.includes(q)) voces.push(ww);
    if (voces.length >= vL) break;
  }

  return { songs, albums, voces };
}
