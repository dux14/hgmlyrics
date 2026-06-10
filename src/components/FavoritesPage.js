/**
 * FavoritesPage.js — list of the signed-in user's favorite songs.
 *
 * Reuses `renderSongList` so the heart overlay on each cover is the
 * "remove from favorites" affordance the user already knows.
 */
import { getState, subscribe as subscribeStore } from '../lib/store.js';
import { subscribe as subscribeFavorites, isFavorite } from '../lib/favorites.js';
import { renderSongList } from './SongList.js';
import { navigate, getCurrentPath } from '../router.js';
import { icon } from '../lib/icons.js';

let unsubFav = null;
let unsubStore = null;

function favoriteSongs() {
  const { songs } = getState();
  return songs.filter((s) => isFavorite(s.id));
}

/**
 * @param {HTMLElement} container
 */
export function renderFavoritesPage(container) {
  if (unsubFav) {
    unsubFav();
    unsubFav = null;
  }
  if (unsubStore) {
    unsubStore();
    unsubStore = null;
  }

  function paint() {
    // Estas suscripciones (favoritos/store) sobreviven a la navegación: solo se
    // limpian al volver a entrar a esta vista. Al cerrar sesión, initFavorites
    // limpia los favoritos y dispara este callback aunque ya estemos en /login,
    // repintando "Mis favoritos" sobre la ruta actual. Si ya no estamos en
    // /favoritos, soltamos las suscripciones y no repintamos.
    if (getCurrentPath().split('?')[0] !== '/favoritos') {
      if (unsubFav) {
        unsubFav();
        unsubFav = null;
      }
      if (unsubStore) {
        unsubStore();
        unsubStore = null;
      }
      return;
    }

    const favs = favoriteSongs();
    container.innerHTML = `
      <div class="profile-page fade-in">
        <div style="display:flex; align-items:center; gap:var(--space-sm); margin-bottom:var(--space-lg);">
          <button class="auth-btn" id="back-btn" style="max-width:140px;">← Volver</button>
          <h1 style="margin:0;">Mis favoritos</h1>
        </div>
        <p class="profile-username" style="margin-bottom:var(--space-md);">${favs.length} canciones</p>
        <div id="fav-list"></div>
      </div>
    `;
    container.querySelector('#back-btn').addEventListener('click', () => navigate('/perfil'));

    const listMount = container.querySelector('#fav-list');
    if (favs.length === 0) {
      listMount.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">${icon('heart', { size: 48 })}</div>
          <h2 class="empty-state__title">Aún no tienes favoritos</h2>
          <p class="empty-state__text">Toca el corazón en cualquier canción para guardarla aquí.</p>
        </div>
      `;
      return;
    }
    renderSongList(listMount, favs);
  }

  paint();

  // Re-paint when the user removes a favorite from this view (or any other).
  unsubFav = subscribeFavorites(() => paint());
  // Re-paint if the underlying songs catalog refreshes (e.g. PWA cache hydration).
  unsubStore = subscribeStore(() => paint());
}
