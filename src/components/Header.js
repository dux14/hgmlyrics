/**
 * Header.js — App header component
 *
 * Icono de menú (grid), oración, toggle de tema y avatar (solo desktop).
 * Sin búsqueda inline — la búsqueda vive en /buscar.
 */

import { navigate } from '../router.js';
import { renderThemeToggle } from './ThemeToggle.js';
import { renderAuthButton } from './AuthButton.js';
import { icon } from '../lib/icons.js';

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
    <button class="header__btn header__btn--menu" id="menu-btn" aria-label="Abrir navegación">
      ${icon('grid', { size: 24 })}
    </button>

    <div class="header__actions" id="header-actions">
      <button class="header__btn" id="prayer-btn" aria-label="Oración del artista" title="Oración del artista">
        ${icon('flame', { size: 20 })}
      </button>
      <div id="theme-toggle-mount"></div>
      <div id="auth-button-mount"></div>
    </div>

    <a href="#/" class="header__logo" id="header-logo" aria-label="HKN Lyrics Inicio">
      <svg width="23" height="29" viewBox="0 0 23 29" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M5.8 0H0V29H5.8V23.2002H16.5195V29H22.3195V0H16.5195V5.79997L5.8 5.79998V0ZM16.5195 11.6L5.8 11.6V17.4002L16.5195 17.4002V11.6Z" fill="currentColor"/>
      </svg>
    </a>
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

  const prayerBtn = header.querySelector('#prayer-btn');
  prayerBtn.addEventListener('click', () => navigate('/oracion'));
}
