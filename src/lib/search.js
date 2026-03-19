/**
 * search.js — FlexSearch wrapper for full-text song search
 *
 * Indexes song titles, albums, artists, and lyrics content.
 * Supports Spanish tokenization and relevance ranking.
 */

import FlexSearch from 'flexsearch';

/** @type {FlexSearch.Index} */
let titleIndex;
/** @type {FlexSearch.Index} */
let lyricsIndex;
/** @type {Map<number, object>} */
const songMap = new Map();

let nextId = 0;
const idToSong = new Map();

/**
 * Build the search index from a song array
 * @param {Array} songs
 */
export function buildIndex(songs) {
  titleIndex = new FlexSearch.Index({
    tokenize: 'forward',
    resolution: 9,
    cache: true,
  });

  lyricsIndex = new FlexSearch.Index({
    tokenize: 'forward',
    resolution: 5,
    cache: true,
  });

  songMap.clear();
  idToSong.clear();
  nextId = 0;

  songs.forEach((song) => {
    const id = nextId++;
    idToSong.set(id, song);

    // Index title + album + artist with high priority
    const titleText = `${song.title} ${song.album} ${song.artist}`;
    titleIndex.add(id, titleText);

    // Index lyrics content
    const lyricsText = song.sections
      .map((section) => section.lines.map((line) => line.text).join(' '))
      .join(' ');
    lyricsIndex.add(id, lyricsText);
  });
}

/**
 * Search for songs matching a query
 * @param {string} query - Search term
 * @param {number} [limit=10] - Max results
 * @returns {Array} Matched songs ranked by relevance
 */
export function searchSongs(query, limit = 10) {
  if (!query || !query.trim()) {
    return [];
  }

  const trimmed = query.trim();

  // Search both indexes
  const titleResults = titleIndex ? titleIndex.search(trimmed, limit) : [];
  const lyricsResults = lyricsIndex ? lyricsIndex.search(trimmed, limit) : [];

  // Merge results — title matches get higher priority
  const scoreMap = new Map();

  titleResults.forEach((id, idx) => {
    scoreMap.set(id, (scoreMap.get(id) || 0) + (limit - idx) * 2);
  });

  lyricsResults.forEach((id, idx) => {
    scoreMap.set(id, (scoreMap.get(id) || 0) + (limit - idx));
  });

  // Sort by score descending
  const sorted = Array.from(scoreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  return sorted.map(([id]) => idToSong.get(id)).filter(Boolean);
}

/**
 * Clear the search index
 */
export function clearIndex() {
  titleIndex = null;
  lyricsIndex = null;
  songMap.clear();
  idToSong.clear();
  nextId = 0;
}
