/**
 * Header.js — App header component
 *
 * Logo, botón-pill de búsqueda (abre command palette), theme toggle, menu button, cache clear.
 */

import { navigate } from '../router.js';
import { renderThemeToggle } from './ThemeToggle.js';
import { renderAuthButton } from './AuthButton.js';
import { icon } from '../lib/icons.js';
import { openCommandPalette } from './CommandPalette.js';

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

    <button class="header__search header__search-trigger" id="search-trigger" type="button" aria-label="Buscar canciones, álbumes">
      <svg class="header__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <span class="header__search-placeholder">Buscar canciones, álbumes…</span>
    </button>

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

  const searchTrigger = header.querySelector('#search-trigger');
  searchTrigger.addEventListener('click', () => openCommandPalette());

  // Cache clear button
  const cacheBtn = header.querySelector('#cache-btn');
  cacheBtn.addEventListener('click', handleCacheClear);

  const prayerBtn = header.querySelector('#prayer-btn');
  prayerBtn.addEventListener('click', () => navigate('/oracion'));
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
