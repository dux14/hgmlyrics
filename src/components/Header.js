/**
 * Header.js — App header component
 *
 * Logo H (izquierda) · Oración · Toggle de tema · Avatar (derecha).
 * El avatar es clickeable y lleva al perfil. El menú de navegación
 * ("Ir a…") vive ahora en el footer (BottomNav) en móvil y en la
 * sidebar en desktop. Sin búsqueda inline — la búsqueda vive en /buscar.
 */

import { navigate } from '../router.js';
import { renderThemeToggle } from './ThemeToggle.js';
import { icon } from '../lib/icons.js';
import { getProfile, subscribe } from '../lib/authStore.js';

/**
 * Devuelve la URL del avatar del usuario, o un avatar por defecto con su inicial.
 * @param {object|null} profile
 * @returns {string}
 */
function avatarSrc(profile) {
  if (profile?.avatarUrl) return profile.avatarUrl;
  const initial = (profile?.displayName || profile?.username || '?').trim().charAt(0).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'><rect width='30' height='30' fill='#01ccd9'/><text x='15' y='20' text-anchor='middle' font-family='sans-serif' font-size='15' fill='#0b0b0b'>${initial}</text></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

/**
 * Render the header into the app
 * @param {HTMLElement} container
 */
export function renderHeader(container) {
  const header = document.createElement('header');
  header.className = 'header';
  header.id = 'app-header';

  header.innerHTML = `
    <a href="#/" class="header__logo" id="header-logo" aria-label="HKN Lyrics Inicio">
      <svg width="23" height="29" viewBox="0 0 23 29" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M5.8 0H0V29H5.8V23.2002H16.5195V29H22.3195V0H16.5195V5.79997L5.8 5.79998V0ZM16.5195 11.6L5.8 11.6V17.4002L16.5195 17.4002V11.6Z" fill="currentColor"/>
      </svg>
    </a>

    <div class="header__actions" id="header-actions">
      <button class="header__btn" id="prayer-btn" aria-label="Oración del artista" title="Oración del artista">
        ${icon('flame', { size: 24 })}
      </button>
      <div id="theme-toggle-mount"></div>
      <a class="header__avatar" id="header-avatar" href="#/perfil" aria-label="Tu perfil" title="Tu perfil">
        <img class="header__avatar-img" alt="" />
      </a>
    </div>
  `;

  container.prepend(header);

  // Theme toggle
  renderThemeToggle(header.querySelector('#theme-toggle-mount'));

  // Oración del artista
  header.querySelector('#prayer-btn').addEventListener('click', () => navigate('/oracion'));

  // Avatar → perfil (se repinta cuando cambia el usuario en authStore)
  const avatarLink = header.querySelector('#header-avatar');
  const img = avatarLink.querySelector('.header__avatar-img');
  const paint = () => {
    img.src = avatarSrc(getProfile());
  };
  paint();
  subscribe(paint);
  avatarLink.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/perfil');
  });
}
