/**
 * search.js — Accent & case insensitive song search
 *
 * Uses normalized substring matching on title, album, artist.
 * Precise results with Spanish accent support.
 */

/** @type {Array} */
let songList = [];

/**
 * Normalize text: strip accents + lowercase for accent-insensitive comparison
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return str.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Build the search index from a song array
 * @param {Array} songs
 */
export function buildIndex(songs) {
  songList = songs;
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
 * Clear the search index
 */
export function clearIndex() {
  songList = [];
}
