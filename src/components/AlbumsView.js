// src/components/AlbumsView.js
// Vista rejilla de todos los álbumes — Fase 2 Home Spotify + Álbumes.

import '../styles/albums.css';
import { navigate } from '../router.js';
import { getAlbums } from '../lib/store.js';
import { resolveCoverUrl } from './songRow.js';
import { escapeHtml } from '../lib/escape.js';
import { COVER_PLACEHOLDER } from '../lib/icons.js';

/**
 * Renderiza la rejilla completa de álbumes en el contenedor dado.
 * @param {HTMLElement} container
 */
export function renderAlbumsView(container) {
  const albums = getAlbums();

  container.innerHTML = `
    <div class="albums-view fade-in">

      <nav class="breadcrumb" aria-label="Ruta de navegación">
        <a href="#/" class="albums-view__home-link">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">Álbumes</span>
      </nav>

      <h1 class="albums-view__title">Álbumes</h1>

      <div class="albums-grid" role="list">
        ${albums
          .map((album) => {
            const coverUrl = resolveCoverUrl(album);
            const artistLabel = album.artist
              ? `<span class="album-card__artist">Álbum · ${escapeHtml(album.artist)}</span>`
              : '';
            return `
              <button
                class="album-card"
                role="listitem"
                data-album-slug="${escapeHtml(album.slug)}"
                aria-label="${escapeHtml(album.name)}"
              >
                <img
                  class="album-card__cover"
                  src="${escapeHtml(coverUrl)}"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onerror="this.src='${COVER_PLACEHOLDER}'"
                />
                <div class="album-card__info">
                  <span class="album-card__name">${escapeHtml(album.name)}</span>
                  ${artistLabel}
                </div>
              </button>`;
          })
          .join('')}
      </div>
    </div>
  `;

  container.querySelector('.albums-view__home-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });

  container.querySelectorAll('.album-card').forEach((card) => {
    card.addEventListener('click', () => navigate(`/album/${card.dataset.albumSlug}`));
  });
}
