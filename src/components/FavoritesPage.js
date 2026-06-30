/**
 * FavoritesPage.js — list of the signed-in user's favorite songs.
 *
 * Reuses `renderSongList` so the heart overlay on each cover is the
 * "remove from favorites" affordance the user already knows.
 */
import '../styles/favorites.css';
import { getState, subscribe as subscribeStore } from '../lib/store.js';
import { subscribe as subscribeFavorites, isFavorite, toggleFavorite } from '../lib/favorites.js';
import { renderSongList } from './SongList.js';
import { navigate, getCurrentPath } from '../router.js';
import { icon } from '../lib/icons.js';
import { resolveCoverUrl } from './songRow.js';
import { escapeHtml } from '../lib/escape.js';

let unsubFav = null;
let unsubStore = null;

export const FAV_VIEW_KEY = 'hkn:fav-view';

export function getFavView() {
  const v = (() => {
    try {
      return localStorage.getItem(FAV_VIEW_KEY);
    } catch {
      return null;
    }
  })();
  return v === 'list' ? 'list' : 'grid';
}

export function setFavView(view) {
  try {
    localStorage.setItem(FAV_VIEW_KEY, view === 'list' ? 'list' : 'grid');
  } catch {
    /* localStorage no disponible (modo privado / cuota): la preferencia no persiste */
  }
}

function buildFavGrid(mount, favs) {
  mount.innerHTML = `<div class="fav-grid">${favs
    .map(
      (s) => `
      <a class="fav-cover" href="#/song/${s.id}" aria-label="${escapeHtml(s.title || '')}">
        <img class="fav-cover__img" src="${resolveCoverUrl(s)}" alt="" loading="lazy" decoding="async" />
        <span class="fav-cover__veil"></span>
        <button class="fav-cover__heart is-on" data-fav-id="${s.id}" aria-label="Quitar de favoritos">${icon('heart', { fill: true, size: 16 })}</button>
        <span class="fav-cover__title">${escapeHtml(s.title || '')}</span>
      </a>`,
    )
    .join('')}</div>`;
  mount.querySelectorAll('.fav-cover__heart').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      toggleFavorite(b.dataset.favId);
    });
  });
}

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
    const view = getFavView();
    container.innerHTML = `
      <div class="profile-page fade-in">
        <div class="fav-header">
          <button class="auth-btn" id="back-btn" style="max-width:120px;">← Volver</button>
          <h1 style="margin:0;">Mis favoritos</h1>
          <div class="seg-tabs fav-toggle" role="tablist">
            <button class="seg-tab${view === 'grid' ? ' seg-tab--active' : ''}" role="tab" aria-selected="${view === 'grid'}" data-view="grid">Grid</button>
            <button class="seg-tab${view === 'list' ? ' seg-tab--active' : ''}" role="tab" aria-selected="${view === 'list'}" data-view="list">Lista</button>
          </div>
        </div>
        <p class="profile-username">${favs.length} canciones</p>
        <div id="fav-list"></div>
      </div>
    `;
    container.querySelector('#back-btn').addEventListener('click', () => navigate('/perfil'));
    container.querySelectorAll('.fav-toggle .seg-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        setFavView(btn.dataset.view);
        paint();
      });
    });

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
    if (view === 'grid') buildFavGrid(listMount, favs);
    else renderSongList(listMount, favs);
  }

  paint();

  // Re-paint when the user removes a favorite from this view (or any other).
  unsubFav = subscribeFavorites(() => paint());
  // Re-paint if the underlying songs catalog refreshes (e.g. PWA cache hydration).
  unsubStore = subscribeStore(() => paint());
}
