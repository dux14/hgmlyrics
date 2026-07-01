/**
 * songTile.js — card del catálogo estilo "tile" (portada + color del tono).
 * Sin label de voz; navega al detalle al hacer click.
 */
import { navigate } from '../router.js';
import { resolveCoverUrl } from './songRow.js';
import { escapeHtml } from '../lib/escape.js';
import { COVER_PLACEHOLDER } from '../lib/icons.js';
import { extractCoverColor } from '../lib/coverColor.js';

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
  const preColor = colorMap[coverKey] || null;
  const color = preColor || FALLBACK;
  // albumFile puede ser un nombre local ('elartedevivir.webp') o una URL http
  // (portada subida a Storage). resolveCoverUrl respeta ambos casos.
  const cover = albumFile ? resolveCoverUrl({ coverImage: albumFile }) : resolveCoverUrl(song);

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
  `;

  // Portada como elemento (no innerHTML) para fijar crossOrigin antes de src y
  // poder extraer el color al cargar cuando no hay uno precomputado en el JSON.
  const art = document.createElement('img');
  art.className = 'song-tile__art';
  art.alt = '';
  art.width = 120;
  art.height = 120;
  art.loading = 'lazy';
  art.decoding = 'async';
  let settled = false; // evita extraer color del placeholder tras un error
  art.addEventListener('error', () => {
    settled = true;
    art.src = COVER_PLACEHOLDER;
  });
  // Sin color precomputado (p. ej. portada remota de Storage): extraerlo al vuelo.
  if (!preColor) {
    art.crossOrigin = 'anonymous';
    art.addEventListener('load', () => {
      if (settled) return;
      settled = true;
      const c = extractCoverColor(art);
      if (c) {
        a.style.setProperty('--tile-c1', c.base);
        a.style.setProperty('--tile-c2', c.light);
      }
    });
  }
  art.src = cover;
  a.appendChild(art);

  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(`/song/${song.id}`);
  });
  return a;
}
