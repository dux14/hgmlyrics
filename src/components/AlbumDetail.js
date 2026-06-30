// src/components/AlbumDetail.js
// Detalle de álbum con hero y tracklist — Fase 3 Home Spotify + Álbumes.

import '../styles/albums.css';
import { navigate } from '../router.js';
import { getState } from '../lib/store.js';
import { resolveCoverUrl, songRowCompact } from './songRow.js';
import { escapeHtml } from '../lib/escape.js';
import { COVER_PLACEHOLDER } from '../lib/icons.js';

/**
 * Renderiza el detalle de un álbum (hero + tracklist) en el contenedor dado.
 * @param {HTMLElement} container
 * @param {string} slug - slug del álbum (coincide con song.albumSlug)
 */
export function renderAlbumDetail(container, slug) {
  const { songs } = getState();

  // Canciones del álbum, ordenadas por albumOrder ascendente.
  const tracks = songs
    .filter((s) => s.albumSlug === slug)
    .sort((a, b) => (a.albumOrder || 0) - (b.albumOrder || 0));

  // Estado vacío: slug sin canciones — muestra mensaje claro, sin crash.
  if (tracks.length === 0) {
    container.innerHTML = `
      <div class="album-detail fade-in">
        <nav class="breadcrumb" aria-label="Ruta de navegación">
          <a href="#/" class="album-detail__home-link">Inicio</a>
          <span class="breadcrumb__separator">›</span>
          <a href="#/albumes" class="album-detail__albums-link">Álbumes</a>
          <span class="breadcrumb__separator">›</span>
          <span class="breadcrumb__current">Álbum no encontrado</span>
        </nav>
        <div class="empty-state">
          <p class="empty-state__text">No se encontró el álbum solicitado.</p>
        </div>
      </div>
    `;
    _bindBreadcrumb(container);
    return;
  }

  // Metadatos del álbum tomados de la primera canción (mismas para todas).
  const first = tracks[0];
  const coverUrl = resolveCoverUrl(first);
  const albumName = first.album || '';
  const artist = first.artist || '';
  const count = tracks.length;
  const countLabel = count === 1 ? '1 canción' : `${count} canciones`;

  container.innerHTML = `
    <div class="album-detail fade-in">

      <nav class="breadcrumb" aria-label="Ruta de navegación">
        <a href="#/" class="album-detail__home-link">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <a href="#/albumes" class="album-detail__albums-link">Álbumes</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">${escapeHtml(albumName)}</span>
      </nav>

      <header class="album-hero">
        <img
          class="album-hero__cover"
          src="${escapeHtml(coverUrl)}"
          alt="Portada de ${escapeHtml(albumName)}"
          width="240"
          height="240"
          loading="eager"
          decoding="async"
          onerror="this.src='${COVER_PLACEHOLDER}'"
        />
        <div class="album-hero__info">
          <h1 class="album-hero__name">${escapeHtml(albumName)}</h1>
          ${artist ? `<p class="album-hero__artist">${escapeHtml(artist)}</p>` : ''}
          <p class="album-hero__count">${escapeHtml(countLabel)}</p>
        </div>
      </header>

      <section class="album-tracklist" aria-label="Canciones del álbum">
        ${tracks.map((song, i) => songRowCompact(song, { index: i + 1 })).join('')}
      </section>

    </div>
  `;

  _bindBreadcrumb(container);

  // Navegación por fila de canción.
  container.querySelectorAll('.song-row-compact').forEach((row) => {
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.addEventListener('click', () => navigate(`/song/${row.dataset.songId}`));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigate(`/song/${row.dataset.songId}`);
      }
    });
  });
}

/** Enlaza los links del breadcrumb con el router. */
function _bindBreadcrumb(container) {
  container.querySelector('.album-detail__home-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });
  container.querySelector('.album-detail__albums-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/albumes');
  });
}
