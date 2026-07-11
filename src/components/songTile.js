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
      <span class="song-tile__group">${escapeHtml(song.artist || 'Hakuna Group Music')}</span>
    </div>
  `;

  // Portada como elemento (no innerHTML) para poder colgar listeners de error
  // y de extracción de color antes de fijar src.
  const art = document.createElement('img');
  art.className = 'song-tile__art';
  art.alt = '';
  art.width = 120;
  art.height = 120;
  art.loading = 'lazy';
  art.decoding = 'async';
  art.addEventListener('error', () => {
    art.src = COVER_PLACEHOLDER;
  });
  // Sin color precomputado (p. ej. portada remota de Storage): extraerlo al
  // vuelo con una Image auxiliar CORS. El <img> visible se queda en no-cors,
  // como el resto de la app: mezclar modos para la misma URL hacía que el SW
  // cacheara la respuesta opaca y la petición CORS del tile quedara rota.
  if (!preColor) {
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.addEventListener('load', () => {
      const c = extractCoverColor(probe);
      if (c) {
        a.style.setProperty('--tile-c1', c.base);
        a.style.setProperty('--tile-c2', c.light);
      }
    });
    probe.src = cover;
  }
  art.src = cover;
  a.appendChild(art);

  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(`/song/${song.id}`);
  });
  return a;
}
