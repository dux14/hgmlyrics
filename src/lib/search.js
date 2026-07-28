/**
 * search.js — Accent & case insensitive song search
 *
 * Dos formas de coincidir sobre título, álbum y artista, ambas insensibles a
 * tildes y mayúsculas:
 *  1. Frase: la consulta aparece como subcadena contigua del campo. Es la
 *     coincidencia fuerte y la que más puntúa.
 *  2. Palabras: TODAS las palabras de la consulta aparecen en el campo, en
 *     cualquier orden y bastando con que cada una sea prefijo de una palabra
 *     del campo. Puntúa por debajo de la frase.
 *
 * La segunda existe porque la puntuación de los títulos rompía la primera:
 * «Tu el unico» no encontraba «(Tú) El único rey - una voz», ya que el
 * paréntesis y la coma quedan en medio de la subcadena. Al tratar la
 * puntuación como separador y no como contenido, el usuario puede escribir
 * solo las palabras que recuerda.
 */

// B6 (perf): campos normalizados precomputados en buildIndex — antes se
// normalizaba (NFD + regex + toLowerCase) título/álbum/artista/voiceover_body
// enteros de CADA canción y CADA weekly_word en cada pulsación de búsqueda.
/** @type {Array<{ song: object, t: string, al: string, ar: string }>} */
let songRecords = [];
/** @type {Array<{ ww: object, t: string, ref: string, lit: string, body: string }>} */
let weeklyRecords = [];

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
 * Palabras de un texto ya normalizado: todo lo que no sea letra o d\u00edgito act\u00faa
 * como separador (par\u00e9ntesis, comas, guiones, ap\u00f3strofos).
 * @param {string} norm
 * @returns {string[]}
 */
function words(norm) {
  return norm.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Punt\u00faa un campo contra la consulta: frase contigua o, si no, todas las
 * palabras presentes como prefijo. Devuelve 0 si no hay coincidencia.
 * @param {string} norm - campo normalizado
 * @param {string[]} toks - palabras del campo
 * @param {string} q - consulta normalizada
 * @param {string[]} qToks - palabras de la consulta
 * @param {{ phrase: number, start?: number, words: number }} w - pesos del campo
 * @returns {number}
 */
function fieldScore(norm, toks, q, qToks, w) {
  if (norm.includes(q)) return norm.startsWith(q) ? w.phrase + (w.start ?? 0) : w.phrase;
  if (qToks.length > 0 && qToks.every((qt) => toks.some((t) => t.startsWith(qt)))) return w.words;
  return 0;
}

/* Pesos por campo. `words` queda siempre por debajo de `phrase` del mismo
   campo y por encima de la coincidencia del campo siguiente en importancia,
   para que el orden relativo de resultados no cambie respecto al de antes. */
const W_TITLE = { phrase: 100, start: 50, words: 70 };
const W_ALBUM = { phrase: 30, words: 20 };
const W_ARTIST = { phrase: 10, words: 6 };
const W_WW_TITLE = { phrase: 120, start: 50, words: 84 };
const W_WW_REF = { phrase: 100, start: 50, words: 70 };
const W_WW_LIT = { phrase: 60, words: 42 };
const W_WW_BODY = { phrase: 20, words: 14 };

/**
 * Build the search index from songs and optional weekly_words.
 * Backward-compatible: buildIndex(songs) still works.
 * @param {Array} songs
 * @param {Array} [weeklyWords]
 */
export function buildIndex(songs, weeklyWords = []) {
  songRecords = songs.map((song) => {
    const t = normalize(song.title || '');
    const al = normalize(song.album || '');
    const ar = normalize(song.artist || '');
    // Las palabras se precomputan junto al campo normalizado por la misma
    // razón que aquel: partir con regex en cada pulsación era el coste que
    // B6 (perf) sacó del camino caliente.
    return { song, t, al, ar, tW: words(t), alW: words(al), arW: words(ar) };
  });
  weeklyRecords = weeklyWords.map((ww) => {
    const t = normalize(ww.title || '');
    const ref = normalize(ww.gospel_ref || '');
    const lit = normalize(ww.liturgical_title || '');
    const body = normalize(ww.voiceover_body || '');
    return {
      ww,
      t,
      ref,
      lit,
      body,
      tW: words(t),
      refW: words(ref),
      litW: words(lit),
      bodyW: words(body),
    };
  });
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

  const q = normalize(query.trim());
  const qW = words(q);

  // Score each song based on where the match is found
  const scored = [];

  for (const { song, t, al, ar, tW, alW, arW } of songRecords) {
    const score =
      fieldScore(t, tW, q, qW, W_TITLE) +
      fieldScore(al, alW, q, qW, W_ALBUM) +
      fieldScore(ar, arW, q, qW, W_ARTIST);

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
  const qW = words(q);
  const scored = [];

  for (const { song, t, al, ar, tW, alW, arW } of songRecords) {
    const score =
      fieldScore(t, tW, q, qW, W_TITLE) +
      fieldScore(al, alW, q, qW, W_ALBUM) +
      fieldScore(ar, arW, q, qW, W_ARTIST);
    if (score > 0) scored.push({ type: 'song', item: song, score });
  }

  for (const { ww, t, ref, lit, body, tW, refW, litW, bodyW } of weeklyRecords) {
    const score =
      fieldScore(t, tW, q, qW, W_WW_TITLE) +
      fieldScore(ref, refW, q, qW, W_WW_REF) +
      fieldScore(lit, litW, q, qW, W_WW_LIT) +
      fieldScore(body, bodyW, q, qW, W_WW_BODY);
    if (score > 0) scored.push({ type: 'weekly_word', item: ww, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Clear the search index (songs + weekly words).
 */
export function clearIndex() {
  songRecords = [];
  weeklyRecords = [];
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
  const qW = words(q);
  const { songs: sL = 40, albums: aL = 10, voces: vL = 8 } = limits;

  const songs = searchSongs(query, sL);

  const albumMap = new Map();
  for (const { song, al, alW } of songRecords) {
    if (!song.albumSlug || albumMap.has(song.albumSlug)) continue;
    if (fieldScore(al, alW, q, qW, W_ALBUM) > 0) {
      albumMap.set(song.albumSlug, {
        slug: song.albumSlug,
        name: song.album,
        coverImage: song.coverImage,
        artist: song.artist,
      });
    }
  }
  const albums = Array.from(albumMap.values()).slice(0, aL);

  const voces = [];
  for (const { ww, t, ref, lit, tW, refW, litW } of weeklyRecords) {
    const hit =
      fieldScore(t, tW, q, qW, W_WW_TITLE) +
      fieldScore(ref, refW, q, qW, W_WW_REF) +
      fieldScore(lit, litW, q, qW, W_WW_LIT);
    if (hit > 0) voces.push(ww);
    if (voces.length >= vL) break;
  }

  return { songs, albums, voces };
}
