/**
 * Sidebar.js — Sidebar component
 *
 * Album filters only (sort and voice moved to FilterBar).
 * Overlay on mobile, fixed panel on desktop.
 */

import { getAlbums, filterByAlbum, getState } from '../lib/store.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';
import { listMyLists } from '../lib/lists.js';
import { openListCreateModal } from './ListCreateModal.js';

let sidebarEl = null;
let overlayEl = null;

/**
 * Render the sidebar
 * @param {HTMLElement} container
 */
export function renderSidebar(container) {
  // Overlay for mobile
  overlayEl = document.createElement('div');
  overlayEl.className = 'sidebar-overlay';
  overlayEl.id = 'sidebar-overlay';
  overlayEl.addEventListener('click', closeSidebar);

  // Sidebar panel
  sidebarEl = document.createElement('aside');
  sidebarEl.className = 'sidebar';
  sidebarEl.id = 'sidebar';

  updateSidebarContent();

  container.appendChild(overlayEl);
  container.appendChild(sidebarEl);
}

/**
 * Re-render sidebar content (called on state changes)
 */
export function updateSidebarContent() {
  if (!sidebarEl) {
    return;
  }

  const albums = getAlbums();
  const { activeAlbum } = getState();

  sidebarEl.innerHTML = `
    <!-- Oración del artista (destacada, primero) -->
    <div class="sidebar__section">
      <div class="sidebar__album-item sidebar__nav-item sidebar__nav-item--featured" data-nav="oracion">
        <span>${icon('flame', { size: 18 })}</span>
        <span>Oración del artista</span>
      </div>
    </div>
    <div class="sidebar__divider" role="separator"></div>

    <!-- Listas efímeras -->
    <div class="sidebar__section" id="sidebar-lists">
      <div class="sidebar__section-title sidebar__section-title--static">
        Listas
        <button class="sidebar__add-btn" id="lists-add" aria-label="Nueva lista">${icon('plus', { size: 16 })}</button>
      </div>
      <div class="sidebar__section-content" id="lists-content">
        <div class="sidebar__empty">Cargando…</div>
      </div>
    </div>
    <div class="sidebar__divider" role="separator"></div>

    <!-- Albums Section -->
    <div class="sidebar__section" id="sidebar-albums">
      <div class="sidebar__section-title" data-section="albums">
        Álbumes
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="sidebar__section-content">
        <div class="sidebar__album-item ${!activeAlbum ? 'active' : ''}" data-album="">
          <span>${icon('music', { size: 16 })}</span>
          <span>Todas las canciones</span>
        </div>
        ${albums
          .map((album) => {
            const coverUrl =
              album.coverImage.startsWith('/') || album.coverImage.startsWith('http')
                ? album.coverImage
                : `/covers/${album.coverImage}`;
            return `
          <div class="sidebar__album-item ${activeAlbum === album.slug ? 'active' : ''}" data-album="${album.slug}">
            <img
              class="sidebar__album-thumb"
              src="${coverUrl}"
              alt="${escapeHtml(album.name)}"
              loading="lazy"
              onerror="this.style.display='none'"
            />
            <span>${escapeHtml(album.name)}</span>
          </div>
        `;
          })
          .join('')}
      </div>
    </div>
  `;

  // Attach event listeners
  bindSidebarEvents();
}

/**
 * Bind click events for sidebar items
 */
function bindSidebarEvents() {
  if (!sidebarEl) {
    return;
  }

  // Section collapse toggles (only collapsible titles, not static ones)
  sidebarEl
    .querySelectorAll('.sidebar__section-title:not(.sidebar__section-title--static)')
    .forEach((title) => {
      title.addEventListener('click', () => {
        const section = title.closest('.sidebar__section');
        section.classList.toggle('collapsed');
      });
    });

  // Botón "Nueva lista"
  sidebarEl.querySelector('#lists-add')?.addEventListener('click', () => {
    openListCreateModal((list) => {
      updateSidebarContent();
      navigate('/lista/' + list.id);
    });
  });

  // Cargar listas de forma asíncrona
  const listsContentEl = sidebarEl.querySelector('#lists-content');
  if (listsContentEl) {
    listMyLists()
      .then((lists) => {
        if (!listsContentEl.isConnected) return;
        if (!lists || lists.length === 0) {
          listsContentEl.innerHTML = `<div class="sidebar__empty">Sin listas aún.</div>`;
          return;
        }
        listsContentEl.innerHTML = lists
          .map(
            (l) => `
            <div class="sidebar__list-item" data-lista-id="${escapeHtml(l.id)}">
              <span class="sidebar__list-item-name">${escapeHtml(l.name)}</span>
              ${l.expires_at ? `<span class="lists__expiry-chip">${escapeHtml(formatExpiry(l.expires_at))}</span>` : ''}
            </div>
          `,
          )
          .join('');

        listsContentEl.querySelectorAll('[data-lista-id]').forEach((item) => {
          item.addEventListener('click', () => {
            navigate('/lista/' + item.dataset.listaId);
            if (window.innerWidth < 768) closeSidebar();
          });
        });
      })
      .catch(() => {
        // Error silencioso
        if (listsContentEl.isConnected) {
          listsContentEl.innerHTML = `<div class="sidebar__empty">Sin listas aún.</div>`;
        }
      });
  }

  // Navegación directa (oración)
  sidebarEl.querySelectorAll('[data-nav]').forEach((item) => {
    item.addEventListener('click', () => {
      const dest = item.dataset.nav;
      if (dest === 'oracion') {
        navigate('/oracion');
      }
      if (window.innerWidth < 768) {
        closeSidebar();
      }
    });
  });

  // Album filter
  sidebarEl.querySelectorAll('[data-album]').forEach((item) => {
    item.addEventListener('click', () => {
      const album = item.dataset.album || null;
      filterByAlbum(album);
      updateSidebarContent();
      navigate('/');

      // Close sidebar on mobile after selecting
      if (window.innerWidth < 768) {
        closeSidebar();
      }
    });
  });
}

/**
 * Toggle sidebar visibility
 */
export function toggleSidebar() {
  if (!sidebarEl) {
    return;
  }
  const isOpen = sidebarEl.classList.contains('open');
  if (isOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

/**
 * Open sidebar
 */
export function openSidebar() {
  if (sidebarEl) {
    sidebarEl.classList.add('open');
  }
  if (overlayEl) {
    overlayEl.classList.add('active');
  }
}

/**
 * Close sidebar
 */
export function closeSidebar() {
  if (sidebarEl) {
    sidebarEl.classList.remove('open');
  }
  if (overlayEl) {
    overlayEl.classList.remove('active');
  }
}

/**
 * Formatea la fecha de caducidad de una lista.
 * @param {string} expiresAt - ISO date string
 * @returns {string}
 */
function formatExpiry(expiresAt) {
  if (!expiresAt) return '';
  const diff = Math.ceil((new Date(expiresAt) - Date.now()) / 86400000);
  if (diff <= 0) return 'caducada';
  if (diff === 1) return 'caduca hoy';
  return `caduca en ${diff}d`;
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
