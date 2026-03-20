/**
 * SongView.js — Lyrics reader component
 *
 * Displays song lyrics with section labels, color highlights,
 * font size controls, and breadcrumb navigation.
 */

import { getSongById, filterByAlbum, fetchSongDetail } from '../lib/store.js';
import { navigate } from '../router.js';

const FONT_SIZE_KEY = 'hkn-lyrics-font-size';
const FONT_STEP = 0.125; // rem
const FONT_MIN = 0.875;
const FONT_MAX = 2.5;

/**
 * Get persisted font size
 * @returns {number}
 */
function getFontSize() {
  try {
    const stored = localStorage.getItem(FONT_SIZE_KEY);
    if (stored) {
      const val = parseFloat(stored);
      if (val >= FONT_MIN && val <= FONT_MAX) {
        return val;
      }
    }
  } catch (_e) {
    // Ignore
  }
  return 1.25; // default
}

/**
 * Save font size
 * @param {number} size
 */
function saveFontSize(size) {
  try {
    localStorage.setItem(FONT_SIZE_KEY, size.toString());
  } catch (_e) {
    // Ignore
  }
}

/**
 * Render the song view
 * @param {HTMLElement} container
 * @param {string} songId
 */
export async function renderSongView(container, songId) {
  let song = getSongById(songId);

  // If no sections cached, fetch full detail from API
  if (!song || !song.sections || song.sections.length === 0) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">⏳</div>
        <h2 class="empty-state__title">Cargando...</h2>
      </div>
    `;
    const detail = await fetchSongDetail(songId);
    if (detail) {
      song = detail;
    }
  }

  if (!song) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">😕</div>
        <h2 class="empty-state__title">Canción no encontrada</h2>
        <p class="empty-state__text">La canción que buscas no existe o fue eliminada.</p>
        <button class="btn btn--primary" style="margin-top: 1rem;" id="go-home-btn">Volver al inicio</button>
      </div>
    `;
    container.querySelector('#go-home-btn')?.addEventListener('click', () => navigate('/'));
    return;
  }

  let fontSize = getFontSize();

  const voiceBadgeClass =
    song.voiceType === 'male'
      ? 'voice-badge--male'
      : song.voiceType === 'female'
        ? 'voice-badge--female'
        : 'voice-badge--mixed';

  const voiceLabel =
    song.voiceType === 'male'
      ? '♂ Masculina'
      : song.voiceType === 'female'
        ? '♀ Femenina'
        : '⚥ Mixta';

  const coverUrl = song.coverImage.startsWith('/') || song.coverImage.startsWith('http')
    ? song.coverImage
    : `/covers/${song.coverImage}`;

  container.innerHTML = `
    <div class="song-view fade-in">
      <!-- Breadcrumb -->
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/" id="breadcrumb-home">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <a href="#/" data-album="${song.albumSlug}" id="breadcrumb-album">${escapeHtml(song.album)}</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">${escapeHtml(song.title)}</span>
      </nav>

      <!-- Song Header -->
      <div class="song-view__header">
        <img
          class="song-view__cover"
          src="${coverUrl}"
          alt="Portada de ${escapeHtml(song.album)}"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%231a1a1a%22 width=%221%22 height=%221%22/><text x=%22.5%22 y=%22.6%22 text-anchor=%22middle%22 font-size=%22.3%22>🎵</text></svg>'"
        />
        <div class="song-view__meta">
          <h1 class="song-view__title">${escapeHtml(song.title)}</h1>
          <p class="song-view__album">${escapeHtml(song.artist)} — ${escapeHtml(song.album)}</p>
          <p class="song-view__year">${song.year || ''} · ${song.genre || ''}</p>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span class="voice-badge ${voiceBadgeClass}">${voiceLabel}</span>
            <div class="voice-bar" style="width: 80px;">
              <div class="voice-bar__male" style="width: ${song.voicePercent?.male || 50}%"></div>
              <div class="voice-bar__female" style="width: ${song.voicePercent?.female || 50}%"></div>
            </div>
            <span style="font-size: 0.75rem; color: var(--color-text-secondary);">
              ${song.voicePercent?.male || 0}% / ${song.voicePercent?.female || 0}%
            </span>
          </div>
        </div>
      </div>

      <!-- Font Controls -->
      <div class="font-controls">
        <button class="font-controls__btn" id="font-decrease" aria-label="Reducir tamaño de letra">A−</button>
        <span class="font-controls__label" id="font-size-label">${fontSize.toFixed(2)}</span>
        <button class="font-controls__btn" id="font-increase" aria-label="Aumentar tamaño de letra">A+</button>
      </div>

      <!-- Lyrics -->
      <div class="lyrics" id="lyrics-content">
        ${renderSections(song.sections)}
      </div>
    </div>
  `;

  // Apply initial font size
  applyFontSize(fontSize);

  // Font controls
  container.querySelector('#font-decrease').addEventListener('click', () => {
    fontSize = Math.max(FONT_MIN, fontSize - FONT_STEP);
    applyFontSize(fontSize);
    saveFontSize(fontSize);
    container.querySelector('#font-size-label').textContent = fontSize.toFixed(2);
  });

  container.querySelector('#font-increase').addEventListener('click', () => {
    fontSize = Math.min(FONT_MAX, fontSize + FONT_STEP);
    applyFontSize(fontSize);
    saveFontSize(fontSize);
    container.querySelector('#font-size-label').textContent = fontSize.toFixed(2);
  });

  // Breadcrumb album link — navigate home and filter by album
  container.querySelector('#breadcrumb-album').addEventListener('click', (e) => {
    e.preventDefault();
    filterByAlbum(song.albumSlug);
    navigate('/');
  });
}

/**
 * Render lyrics sections
 * @param {Array} sections
 * @returns {string}
 */
function renderSections(sections) {
  return sections
    .map(
      (section) => `
    <div class="lyrics__section lyrics__section--${section.type}">
      <div class="lyrics__section-label">${escapeHtml(section.label)}</div>
      ${section.lines
        .map(
          (line) => `
        <p class="lyrics__line" ${line.color ? `style="color: ${line.color}"` : ''}>
          ${line.text.trim() === '' ? '&nbsp;' : escapeHtml(line.text)}
        </p>
      `,
        )
        .join('')}
    </div>
  `,
    )
    .join('');
}

/**
 * Apply font size to lyrics lines
 * @param {number} size - Font size in rem
 */
function applyFontSize(size) {
  const lyricsEl = document.querySelector('#lyrics-content');
  if (lyricsEl) {
    lyricsEl.querySelectorAll('.lyrics__line').forEach((line) => {
      line.style.fontSize = `${size}rem`;
    });
  }
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
