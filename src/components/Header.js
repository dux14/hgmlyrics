/**
 * Header.js — App header component
 *
 * Logo, search bar with real-time results, theme toggle, menu button, and cache clear.
 */

import { searchSongs } from '../lib/search.js';
import { navigate } from '../router.js';
import { renderThemeToggle } from './ThemeToggle.js';

let searchTimeout = null;

/**
 * Render the header into the app
 * @param {HTMLElement} container
 * @param {object} options
 * @param {Function} options.onMenuToggle - Callback for hamburger menu
 */
export function renderHeader(container, { onMenuToggle }) {
  const header = document.createElement('header');
  header.className = 'header';
  header.id = 'app-header';

  header.innerHTML = `
    <button class="header__btn header__btn--menu" id="menu-btn" aria-label="Abrir menú">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>

    <a href="#/" class="header__logo" id="header-logo">HKN <span>Lyrics</span></a>

    <div class="header__search" id="search-container">
      <svg class="header__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input
        type="search"
        class="header__search-input"
        id="search-input"
        placeholder="Buscar canciones, álbumes..."
        autocomplete="off"
      />
      <div class="search-results" id="search-results" style="display: none;"></div>
    </div>

    <div class="header__actions" id="header-actions">
      <div id="theme-toggle-mount"></div>
      <button class="header__btn" id="cache-btn" aria-label="Limpiar caché" title="Limpiar caché y recargar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
    </div>
  `;

  container.prepend(header);

  // Theme toggle
  const themeMount = header.querySelector('#theme-toggle-mount');
  renderThemeToggle(themeMount);

  // Event listeners
  const menuBtn = header.querySelector('#menu-btn');
  menuBtn.addEventListener('click', onMenuToggle);

  const searchInput = header.querySelector('#search-input');
  const searchResults = header.querySelector('#search-results');

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      handleSearch(e.target.value, searchResults);
    }, 200);
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) {
      handleSearch(searchInput.value, searchResults);
    }
  });

  // Close search results on outside click
  document.addEventListener('click', (e) => {
    if (!header.querySelector('#search-container').contains(e.target)) {
      searchResults.style.display = 'none';
    }
  });

  // Cache clear button
  const cacheBtn = header.querySelector('#cache-btn');
  cacheBtn.addEventListener('click', handleCacheClear);
}

/**
 * Handle search input
 * @param {string} query
 * @param {HTMLElement} resultsEl
 */
function handleSearch(query, resultsEl) {
  if (!query.trim()) {
    resultsEl.style.display = 'none';
    return;
  }

  const results = searchSongs(query, 8);

  if (results.length === 0) {
    resultsEl.innerHTML = `
      <div class="search-results__empty">
        No se encontraron resultados para "${escapeHtml(query)}"
      </div>
    `;
    resultsEl.style.display = 'block';
    return;
  }

  resultsEl.innerHTML = results
    .map(
      (song) => {
        const coverUrl = song.coverImage.startsWith('/') || song.coverImage.startsWith('http')
          ? song.coverImage
          : `/covers/${song.coverImage}`;
        return `
    <div class="search-results__item" data-song-id="${song.id}">
      <img
        class="sidebar__album-thumb"
        src="${coverUrl}"
        alt="${escapeHtml(song.album)}"
        loading="lazy"
        onerror="this.style.display='none'"
      />
      <div>
        <div style="font-weight: 600; font-size: 0.875rem;">${escapeHtml(song.title)}</div>
        <div style="font-size: 0.75rem; color: var(--color-text-secondary);">${escapeHtml(song.album)}</div>
      </div>
    </div>
  `;
      },
    )
    .join('');

  resultsEl.style.display = 'block';

  // Click handlers for search results
  resultsEl.querySelectorAll('.search-results__item').forEach((item) => {
    item.addEventListener('click', () => {
      const songId = item.dataset.songId;
      navigate(`/song/${songId}`);
      resultsEl.style.display = 'none';
      document.querySelector('#search-input').value = '';
    });
  });
}

/**
 * Handle cache clear button
 */
async function handleCacheClear() {
  const btn = document.querySelector('#cache-btn');
  btn.style.opacity = '0.5';
  btn.disabled = true;

  try {
    // Clear all caches
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    // Show toast
    showToast('Caché limpiado. Recargando...');

    // Reload after brief delay
    setTimeout(() => {
      location.reload();
    }, 800);
  } catch (_e) {
    showToast('Error al limpiar caché');
    btn.style.opacity = '1';
    btn.disabled = false;
  }
}

/**
 * Show a toast notification
 * @param {string} message
 */
function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
