// src/components/Home.js
// Vista principal — orden Spotify: Reciente · Listas · Álbumes · Voz en off · Oración · Favoritos
import '../styles/home.css';
import { navigate } from '../router.js';
import { getState, getAlbums } from '../lib/store.js';
import { createSongCard } from './SongList.js';
import { isAuthenticated } from '../lib/authStore.js';
import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { urgencyOf, sortByUrgency, countdownLabel } from '../lib/listUrgency.js';
import { resolveCoverUrl } from './songRow.js';
import { listMyLists, warmList } from '../lib/lists.js';
import { cached } from '../lib/prefetch.js';
import { getWeeklyWords } from '../lib/weeklyWords.js';
import { getFavoriteIds } from '../lib/favorites.js';
import { isVigente } from './VoicesAlbumView.js';
import { voiceoverCoverHtml } from '../lib/voiceoverCover.js';
import { getRecentVisitIds, subscribe as subscribeRecentVisits } from '../lib/recentVisits.js';

// Suscripción viva al historial de recientes; se reemplaza en cada render
// del Home (mismo patrón que favUnsubscribe en SongList.js).
let recentUnsubscribe = null;

/**
 * Ordena canciones por año desc y acota al límite indicado.
 * @param {Array} songs
 * @param {number} [limit=6]
 * @returns {Array}
 */
export function selectRecent(songs, limit = 6) {
  return [...(songs || [])]
    .sort((a, b) => (b.year || 0) - (a.year || 0) || (b.albumOrder || 0) - (a.albumOrder || 0))
    .slice(0, limit);
}

/**
 * Selecciona las canciones para la sección "Reciente": primero las
 * visitadas por el usuario (en orden de visita), y si faltan para llegar
 * al límite, rellena con las más nuevas del catálogo (heurística de
 * selectRecent), sin duplicar.
 * @param {Array} songs
 * @param {string[]} visitIds IDs visitados, del más reciente al más antiguo.
 * @param {number} [limit=6]
 * @returns {Array}
 */
export function selectRecentlyVisited(songs, visitIds, limit = 6) {
  const byId = new Map((songs || []).map((s) => [s.id, s]));
  const visited = (visitIds || [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, limit);

  if (visited.length >= limit) return visited;

  const seen = new Set(visited.map((s) => s.id));
  const fill = selectRecent(songs, limit + visited.length).filter((s) => !seen.has(s.id));

  return [...visited, ...fill].slice(0, limit);
}

/**
 * Formatea una fecha ISO como "DD/M" para mostrar la caducidad.
 * @param {string|null|undefined} isoDate
 * @returns {string|null}
 */
function formatExpiresShort(isoDate) {
  if (!isoDate) return null;
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/**
 * Formatea una fecha ISO como "15 jun" para el card de voz en off.
 * @param {string} isoDate
 * @returns {string}
 */
function formatShortDate(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * HTML de una fila de lista.
 * @param {object} list
 * @param {string} today YYYY-MM-DD
 * @returns {string}
 */
export function listRowHtml(list, today) {
  const count = list.song_count ?? list.songs_count ?? list.item_count ?? list.items_count ?? 0;
  const { level, daysLeft } = urgencyOf(list, today);
  let meta = `${count} ${count === 1 ? 'canción' : 'canciones'}`;
  const expires = formatExpiresShort(list.expires_at);
  if (expires) meta += ` · caduca ${expires}`;
  else if (list.is_shared) meta += ' · compartida';
  return `
    <button class="home__list-row -${level}" data-list-id="${escapeHtml(list.id)}">
      <span class="home__list-ic">${icon('list', { size: 18 })}</span>
      <span class="home__list-info">
        <span class="home__list-name">
          <span class="home__list-dot -${level}" aria-hidden="true"></span>
          ${escapeHtml(list.name)}
        </span>
        <span class="home__list-meta">${escapeHtml(meta)}</span>
      </span>
      <span class="home__list-pill -${level}">${escapeHtml(countdownLabel(daysLeft))}</span>
    </button>`;
}

/**
 * HTML del cuerpo de la sección Listas.
 * @param {Array} lists
 * @param {string} today YYYY-MM-DD
 * @returns {string}
 */
export function renderListsBody(lists, today, { limit } = {}) {
  if (!Array.isArray(lists) || lists.length === 0) {
    return `
      <p class="home__list-empty">Aún no tienes listas guardadas.</p>
      <button class="home__list-create" data-create-list>
        ${icon('plus', { size: 16 })}Crear tu primera lista
      </button>`;
  }
  const ordered = sortByUrgency(lists);
  const shown = limit ? ordered.slice(0, limit) : ordered;
  return `
    ${shown.map((l) => listRowHtml(l, today)).join('')}
    <button class="home__list-create" data-create-list>
      ${icon('plus', { size: 16 })}Crear nueva lista
    </button>`;
}

/**
 * HTML de la card de la voz en off vigente.
 * @param {object} word
 * @returns {string}
 */
function vozCardHtml(word) {
  return `
    <button class="home__voz-card" data-voz-id="${escapeHtml(word.id)}">
      ${voiceoverCoverHtml(word.liturgical_color, { size: 44, radius: 10 })}
      <span class="home__voz-info">
        <span class="home__voz-ref">${escapeHtml(word.gospel_ref ?? '')}</span>
        <span class="home__voz-date">${escapeHtml(formatShortDate(word.sunday_date))}</span>
        <span class="home__voz-badge">VIGENTE</span>
      </span>
      ${icon('chevron-right', { size: 16, className: 'home__voz-arr' })}
    </button>`;
}

function listsSkeletonHtml() {
  return `<div class="home__list-skeleton" aria-hidden="true">
    <div class="home__skel-row"></div>
    <div class="home__skel-row"></div>
    <div class="home__skel-row"></div>
  </div>`;
}

function vozSkeletonHtml() {
  return `<div class="home__voz-skeleton" aria-hidden="true"></div>`;
}

/**
 * Renderiza la vista principal.
 * @param {HTMLElement} container
 * @param {{ today?: string }} [opts] Inyectable en tests (YYYY-MM-DD). Producción usa Date.now.
 */
export async function renderHome(
  container,
  { today = new Date().toISOString().slice(0, 10) } = {},
) {
  const { songs } = getState();
  const albums = getAlbums().slice(0, 5);
  const recent = selectRecentlyVisited(songs, getRecentVisitIds(), 6);
  const favIds = getFavoriteIds();
  const favSongs = favIds
    .map((id) => songs.find((s) => s.id === id))
    .filter(Boolean)
    .slice(0, 6);

  container.innerHTML = `
    <div class="home fade-in">

      <!-- Reciente -->
      <section class="home__module" aria-labelledby="home-recent-hd">
        <div class="home__hd">
          <h2 class="home__hd-title" id="home-recent-hd">Reciente</h2>
          <button class="home__all" data-nav="/buscar">Ver todos</button>
        </div>
        <div class="home__strip" id="home-recent-strip"></div>
      </section>

      <!-- Listas (ocultar si invitado o error de red) -->
      <section class="home__module" id="section-listas" aria-labelledby="home-listas-hd">
        <div class="home__hd">
          <h2 class="home__hd-title" id="home-listas-hd">Listas</h2>
          <button class="home__all" data-nav="/listas">Ver todos</button>
        </div>
        <div id="home-listas-body">${listsSkeletonHtml()}</div>
      </section>

      <!-- Álbumes -->
      <section class="home__module" aria-labelledby="home-albums-hd">
        <div class="home__hd">
          <h2 class="home__hd-title" id="home-albums-hd">Álbumes</h2>
          <button class="home__all" data-nav="/albumes">Ver todos</button>
        </div>
        <div class="home__albums-rail">
          ${albums
            .map(
              (a) => `
            <button class="home__album-card" data-album-slug="${escapeHtml(a.slug)}">
              <img class="home__album-cover"
                src="${escapeHtml(resolveCoverUrl(a))}"
                alt=""
                loading="lazy"
                onerror="this.style.visibility='hidden'" />
              <div class="home__album-body">
                <div class="home__album-name">${escapeHtml(a.name)}</div>
                ${a.artist ? `<div class="home__album-artist">${escapeHtml(a.artist)}</div>` : ''}
              </div>
            </button>`,
            )
            .join('')}
        </div>
      </section>

      <!-- Voz en off (ocultar si no hay vigente) -->
      <section class="home__module" id="section-voz" aria-labelledby="home-voz-hd">
        <div class="home__hd">
          <h2 class="home__hd-title" id="home-voz-hd">Voz en off</h2>
          <button class="home__all" data-nav="/voces">Ver todos</button>
        </div>
        <div id="home-voz-body">${vozSkeletonHtml()}</div>
      </section>

      <!-- Oración -->
      <section class="home__module">
        <button class="home__teaser" data-nav="/oracion">
          <span class="home__teaser-ic">${icon('flame', { size: 22 })}</span>
          <span class="home__teaser-tx">
            <span class="home__teaser-t">Oración del artista</span>
            <span class="home__teaser-s">Una palabra para hoy</span>
          </span>
          ${icon('chevron-right', { size: 16, className: 'home__teaser-arr' })}
        </button>
      </section>

      <!-- Favoritos (ocultar si vacío) -->
      ${
        favSongs.length > 0
          ? `
      <section class="home__module" aria-labelledby="home-fav-hd">
        <div class="home__hd">
          <h2 class="home__hd-title" id="home-fav-hd">Favoritos</h2>
          <button class="home__all" data-nav="/favoritos">Ver todos</button>
        </div>
        <div class="home__strip" id="home-fav-strip"></div>
      </section>`
          : ''
      }

    </div>
  `;

  // Navegación genérica por data-nav
  container
    .querySelectorAll('[data-nav]')
    .forEach((el) => el.addEventListener('click', () => navigate(el.dataset.nav)));

  // Strip de canciones recientes
  const recentStrip = container.querySelector('#home-recent-strip');
  recent.forEach((song, i) => recentStrip?.appendChild(createSongCard(song, i)));

  // Repintar SOLO el rail Reciente cuando el sync con la cuenta cambie el
  // historial (p. ej. visitas hechas en otro dispositivo), sin re-render
  // completo de la vista.
  recentUnsubscribe?.();
  recentUnsubscribe = subscribeRecentVisits(() => {
    const strip = container.querySelector('#home-recent-strip');
    if (!strip || !strip.isConnected) return;
    const fresh = selectRecentlyVisited(getState().songs, getRecentVisitIds(), 6);
    strip.replaceChildren(...fresh.map((song, i) => createSongCard(song, i)));
  });

  // Cards de álbum individuales
  container
    .querySelectorAll('[data-album-slug]')
    .forEach((el) =>
      el.addEventListener('click', () => navigate(`/album/${el.dataset.albumSlug}`)),
    );

  // Strip de favoritos
  const favStrip = container.querySelector('#home-fav-strip');
  favSongs.forEach((song, i) => favStrip?.appendChild(createSongCard(song, i)));

  // ── Async: Listas ────────────────────────────────────────────
  if (!isAuthenticated()) {
    container.querySelector('#section-listas')?.remove();
  } else {
    try {
      const { data: lists } = await cached('lists', listMyLists);
      const listsBody = container.querySelector('#home-listas-body');
      if (listsBody) {
        listsBody.innerHTML = renderListsBody(lists, today, { limit: 3 });
        listsBody
          .querySelectorAll('[data-list-id]')
          .forEach((el) =>
            el.addEventListener('click', () => navigate(`/lista/${el.dataset.listId}`)),
          );
        listsBody
          .querySelector('[data-create-list]')
          ?.addEventListener('click', () => navigate('/lista/nueva'));
      }
      // Warm-up progresivo: detalle de las primeras listas (salta si save-data).
      const saveData = globalThis.navigator?.connection?.saveData;
      if (!saveData) {
        sortByUrgency(lists)
          .slice(0, 4)
          .forEach((l) => warmList(l.id));
      }
    } catch {
      container.querySelector('#section-listas')?.remove();
    }
  }

  // ── Async: Voz en off ────────────────────────────────────────
  try {
    const words = await getWeeklyWords();
    // Elegir la más reciente entre las vigentes (sunday_date ≤ hoy).
    // No se asume orden de la API: se toma el máximo sunday_date explícitamente.
    const vigente = words
      .filter((w) => isVigente(w.sunday_date, today))
      .reduce((best, w) => (best && best.sunday_date >= w.sunday_date ? best : w), null);
    const vozBody = container.querySelector('#home-voz-body');
    if (!vigente) {
      container.querySelector('#section-voz')?.remove();
    } else if (vozBody) {
      vozBody.innerHTML = vozCardHtml(vigente);
      vozBody
        .querySelector('[data-voz-id]')
        ?.addEventListener('click', () => navigate(`/voz/${vigente.id}`));
    }
  } catch {
    container.querySelector('#section-voz')?.remove();
  }
}
