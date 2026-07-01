/**
 * songTile.js — card del catálogo estilo "tile" (portada + color del tono).
 * Sin label de voz; navega al detalle al hacer click.
 */
import { navigate } from '../router.js';
import { resolveCoverUrl } from './songRow.js';
import { escapeHtml } from '../lib/escape.js';
import { COVER_PLACEHOLDER } from '../lib/icons.js';

const FALLBACK = { base: '#3a3a3a', light: '#565656' };

/**
 * @param {object} song - forma de /api/songs
 * @param {Record<string,{base:string,light:string}>} colorMap - de cover-colors.json
 * @param {Record<string,string>} coverBySlug - albumSlug → filename (p.ej. 'el-arte-de-vivir' → 'elartedevivir.webp')
 * @returns {HTMLAnchorElement}
 */
export function songTile(song, colorMap = {}, coverBySlug = {}) {
  const albumFile = (song.albumSlug && coverBySlug[song.albumSlug]) || null;
  const coverKey = albumFile || song.coverImage || '';
  const color = colorMap[coverKey] || FALLBACK;
  const cover = albumFile ? `/covers/${albumFile}` : resolveCoverUrl(song);

  const a = document.createElement('a');
  a.className = 'song-tile';
  a.href = `/song/${song.id}`;
  a.style.setProperty('--tile-c1', color.base);
  a.style.setProperty('--tile-c2', color.light);
  a.setAttribute('aria-label', `${song.title} — ${song.album}`);
  a.innerHTML = `
    <div class="song-tile__plate" aria-hidden="true"></div>
    <div class="song-tile__txt">
      <span class="song-tile__title">${escapeHtml(song.title)}</span>
      <span class="song-tile__group">Hakuna Group Music</span>
    </div>
    <img class="song-tile__art" src="${cover}" alt="" width="120" height="120"
         loading="lazy" decoding="async" onerror="this.src='${COVER_PLACEHOLDER}'">
  `;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(`/song/${song.id}`);
  });
  return a;
}
