/**
 * SongList.js — Song grid/list component
 *
 * Displays filtered songs as cards with album covers, titles, and voice badges.
 */

import { navigate } from '../router.js';
import { isPWA, isSongCached } from '../lib/offlineCache.js';

let currentViewMode = localStorage.getItem('hkn-view-mode') || 'grid';

/**
 * Render the song list
 * @param {HTMLElement} container - Mount point
 * @param {Array} songs - Songs to display
 */
export function renderSongList(container, songs) {
  container.innerHTML = '';

  if (songs.length === 0) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">🎵</div>
        <h2 class="empty-state__title">No se encontraron canciones</h2>
        <p class="empty-state__text">Intenta ajustar los filtros o busca por otro término.</p>
      </div>
    `;
    return;
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'song-view-toolbar';
  toolbar.innerHTML = `
    <span style="color: var(--color-text-secondary); font-size: 0.875rem;">${songs.length} resultados</span>
    <div class="song-view-toggle">
      <button class="view-btn ${currentViewMode === 'grid' ? 'active' : ''}" data-view="grid" title="Cuadrícula">▦</button>
      <button class="view-btn ${currentViewMode === 'list' ? 'active' : ''}" data-view="list" title="Lista">☰</button>
    </div>
  `;
  container.appendChild(toolbar);

  toolbar.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentViewMode = btn.dataset.view;
      localStorage.setItem('hkn-view-mode', currentViewMode);
      renderSongList(container, songs);
    });
  });

  const listContainer = document.createElement('div');
  listContainer.className = currentViewMode === 'grid' ? 'song-grid' : 'song-table-container';

  if (currentViewMode === 'grid') {
    songs.forEach((song, index) => {
      listContainer.appendChild(createSongCard(song, index));
    });
  } else {
    listContainer.appendChild(createSongTable(songs));
  }

  container.appendChild(listContainer);
}

/**
 * Render skeleton loading cards
 * @param {HTMLElement} container
 * @param {number} count
 */
export function renderSongListSkeleton(container, count = 6) {
  const grid = document.createElement('div');
  grid.className = 'song-grid';

  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'song-card song-card--skeleton';
    card.innerHTML = `
      <div class="song-card__cover skeleton"></div>
      <div class="song-card__info">
        <div class="song-card__title skeleton">&nbsp;</div>
        <div class="song-card__album skeleton">&nbsp;</div>
      </div>
    `;
    grid.appendChild(card);
  }

  container.innerHTML = '';
  container.appendChild(grid);
}

/**
 * Create a song card element
 * @param {object} song
 * @param {number} index - For staggered animation
 * @returns {HTMLElement}
 */
function createSongCard(song, index) {
  const card = document.createElement('article');
  card.className = 'song-card fade-in';
  card.style.animationDelay = `${index * 50}ms`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${song.title} — ${song.album}`);

  const voiceBadgeClass =
    song.voiceType === 'male'
      ? 'voice-badge--male'
      : song.voiceType === 'female'
        ? 'voice-badge--female'
        : 'voice-badge--mixed';

  const voiceLabel =
    song.voiceType === 'male' ? 'Masculina' : song.voiceType === 'female' ? 'Femenina' : 'Mixta';

  const coverUrl =
    song.coverImage.startsWith('/') || song.coverImage.startsWith('http')
      ? song.coverImage
      : `/covers/${song.coverImage}`;

  // First card above the fold is the LCP candidate: load eagerly + high priority.
  const isLCP = index === 0;
  const imgLoading = isLCP ? 'eager' : 'lazy';
  const imgFetchPriority = isLCP ? 'high' : 'auto';

  card.innerHTML = `
    <img
      class="song-card__cover"
      src="${coverUrl}"
      alt="Portada de ${escapeHtml(song.album)}"
      loading="${imgLoading}"
      decoding="async"
      fetchpriority="${imgFetchPriority}"
      onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%231a1a1a%22 width=%221%22 height=%221%22/><text x=%22.5%22 y=%22.6%22 text-anchor=%22middle%22 font-size=%22.4%22>🎵</text></svg>'"
    />
    <div class="song-card__info">
      <h3 class="song-card__title">${escapeHtml(song.title)}</h3>
      <p class="song-card__album">${escapeHtml(song.album)} · ${song.year || ''}</p>
      <div class="song-card__meta">
        <span class="voice-badge ${voiceBadgeClass}">${voiceLabel}</span>
        <div class="voice-bar" style="width: 60px;" title="${song.voicePercent?.male || 0}% masc. / ${song.voicePercent?.female || 0}% fem.">
          <div class="voice-bar__male" style="width: ${song.voicePercent?.male || 50}%"></div>
          <div class="voice-bar__female" style="width: ${song.voicePercent?.female || 50}%"></div>
        </div>
      </div>
    </div>
  `;

  // Navigation click
  card.addEventListener('click', () => {
    navigate(`/song/${song.id}`);
  });

  // Keyboard accessibility
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`/song/${song.id}`);
    }
  });

  // F8: Offline badge in PWA mode
  if (isPWA()) {
    isSongCached(song.id).then((cached) => {
      if (cached) {
        const badge = document.createElement('span');
        badge.className = 'offline-badge';
        badge.textContent = '✓ Offline';
        card.querySelector('.song-card__meta')?.appendChild(badge);
      }
    });
  }

  return card;
}

/**
 * Create a song table element
 * @param {Array} songs
 * @returns {HTMLElement}
 */
function createSongTable(songs) {
  const table = document.createElement('table');
  table.className = 'song-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width: 50px;"></th>
        <th>Título</th>
        <th>Artista</th>
        <th>Álbum</th>
        <th>Año / Género</th>
        <th>Tipo Voz</th>
      </tr>
    </thead>
    <tbody>
      ${songs
        .map((song, i) => {
          const coverUrl =
            song.coverImage.startsWith('/') || song.coverImage.startsWith('http')
              ? song.coverImage
              : `/covers/${song.coverImage}`;

          const voiceBadgeClass =
            song.voiceType === 'male'
              ? 'voice-badge--male'
              : song.voiceType === 'female'
                ? 'voice-badge--female'
                : 'voice-badge--mixed';
          const voiceLabel =
            song.voiceType === 'male'
              ? 'Masculina'
              : song.voiceType === 'female'
                ? 'Femenina'
                : 'Mixta';

          return `
          <tr class="song-table__row fade-in" style="animation-delay: ${i * 30}ms" data-id="${song.id}" tabindex="0">
            <td>
              <img src="${coverUrl}" class="song-table__thumb" width="40" height="40" loading="lazy" decoding="async" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%231a1a1a%22 width=%221%22 height=%221%22/><text x=%22.5%22 y=%22.6%22 text-anchor=%22middle%22 font-size=%22.4%22>🎵</text></svg>'" />
            </td>
            <td class="song-table__title">${escapeHtml(song.title)}</td>
            <td>${escapeHtml(song.artist)}</td>
            <td class="song-table__meta">${escapeHtml(song.album)}</td>
            <td class="song-table__meta">${song.year || ''} <span style="font-size:0.75rem;opacity:0.7">${escapeHtml(song.genre || '')}</span></td>
            <td><span class="voice-badge ${voiceBadgeClass}">${voiceLabel}</span></td>
          </tr>
        `;
        })
        .join('')}
    </tbody>
  `;

  table.querySelectorAll('.song-table__row').forEach((row) => {
    row.addEventListener('click', () => navigate(`/song/${row.dataset.id}`));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigate(`/song/${row.dataset.id}`);
      }
    });
  });

  return table;
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
