/**
 * Header.js — App header component
 *
 * Logo, search bar with real-time results, theme toggle, menu button, and cache clear.
 */

import { searchAll } from '../lib/search.js';
import { navigate } from '../router.js';
import { renderThemeToggle } from './ThemeToggle.js';
import { renderAuthButton } from './AuthButton.js';
import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';

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

    <a href="#/" class="header__logo" id="header-logo" aria-label="HKN Lyrics Inicio">
      <svg width="23" height="29" viewBox="0 0 23 29" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M5.8 0H0V29H5.8V23.2002H16.5195V29H22.3195V0H16.5195V5.79997L5.8 5.79998V0ZM16.5195 11.6L5.8 11.6V17.4002L16.5195 17.4002V11.6Z" fill="currentColor"/>
      </svg>
    </a>

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
      <button class="header__btn" id="cache-btn" aria-label="Limpiar caché" title="Limpiar caché y recargar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
      <button class="header__btn" id="prayer-btn" aria-label="Oración del artista" title="Oración del artista">
        ${icon('flame', { size: 20 })}
      </button>
      <div id="theme-toggle-mount"></div>
      <div id="auth-button-mount"></div>
    </div>
  `;

  container.prepend(header);

  // Theme toggle
  const themeMount = header.querySelector('#theme-toggle-mount');
  renderThemeToggle(themeMount);

  const authMount = header.querySelector('#auth-button-mount');
  renderAuthButton(authMount);

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

  const prayerBtn = header.querySelector('#prayer-btn');
  prayerBtn.addEventListener('click', () => navigate('/oracion'));
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

  const results = searchAll(query, 8);

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
    .map(({ type, item }) => {
      if (type === 'song') {
        const coverUrl =
          item.coverImage.startsWith('/') || item.coverImage.startsWith('http')
            ? item.coverImage
            : `/covers/${item.coverImage}`;
        return `
    <div class="search-results__item" data-song-id="${escapeHtml(item.id)}">
      <img
        class="sidebar__album-thumb"
        src="${coverUrl}"
        alt="${escapeHtml(item.album)}"
        loading="lazy"
        onerror="this.style.display='none'"
      />
      <div>
        <div style="font-weight: 600; font-size: 0.875rem;">${escapeHtml(item.title)}</div>
        <div style="font-size: 0.75rem; color: var(--color-text-secondary);">${escapeHtml(item.album)}</div>
      </div>
    </div>
  `;
      }
      // weekly_word
      return `
    <div class="search-results__item" data-voz-id="${escapeHtml(item.id)}">
      <div style="width: 32px; height: 32px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">🕊</div>
      <div>
        <div style="font-weight: 600; font-size: 0.875rem;">${escapeHtml(item.gospel_ref)}</div>
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span style="font-size: 0.75rem; color: var(--color-text-secondary);">${escapeHtml(item.liturgical_title || 'Voz en off')}</span>
          <span style="background: #2563eb; color: #fff; border-radius: 999px; padding: 0.1em 0.5em; font-size: 0.65rem; font-weight: 700;">VOZ EN OFF</span>
        </div>
      </div>
    </div>
  `;
    })
    .join('');

  resultsEl.style.display = 'block';

  // Click handlers for search results
  resultsEl.querySelectorAll('[data-song-id]').forEach((item) => {
    item.addEventListener('click', () => {
      navigate(`/song/${item.dataset.songId}`);
      resultsEl.style.display = 'none';
      document.querySelector('#search-input').value = '';
    });
  });

  resultsEl.querySelectorAll('[data-voz-id]').forEach((item) => {
    item.addEventListener('click', () => {
      navigate(`/voz/${item.dataset.vozId}`);
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
