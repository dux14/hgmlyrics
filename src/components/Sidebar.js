/**
 * Sidebar.js — Sidebar component
 *
 * Album filters only (sort and voice moved to FilterBar).
 * Overlay on mobile, fixed panel on desktop.
 */

import { getAlbums, filterByAlbum, getState } from '../lib/store.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { listMyLists } from '../lib/lists.js';
import { expiryBand } from '../lib/listDraft.js';

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
      <div class="sidebar__section-title" data-section="lists">
        <span>Listas</span>
        <span class="sidebar__section-actions">
          <button class="sidebar__add-btn" id="lists-add" aria-label="Nueva lista">${icon('plus', { size: 16 })}</button>
          <svg class="sidebar__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
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
        <svg class="sidebar__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="sidebar__section-content">
        <div class="sidebar__album-item" data-nav="voces">
          <span style="font-size: 1.1rem;">🕊</span>
          <span>Voces en off</span>
        </div>
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

  // Section collapse toggles
  sidebarEl.querySelectorAll('.sidebar__section-title').forEach((title) => {
    title.addEventListener('click', () => {
      const section = title.closest('.sidebar__section');
      section.classList.toggle('collapsed');
    });
  });

  // Botón "Nueva lista" → editor único en /lista/nueva.
  // stopPropagation para no togglear el colapso de la sección al clicar el botón.
  sidebarEl.querySelector('#lists-add')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigate('/lista/nueva');
    if (window.innerWidth < 768) closeSidebar();
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
        listsContentEl.innerHTML = sortListsByExpiry(lists).map(listItemHtml).join('');

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
      if (dest === 'voces') {
        navigate('/voces');
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
 * Escape HTML
 */
/** Ordena listas: por expires_at ascendente; sin fecha o fecha inválida al final. No muta. */
export function sortListsByExpiry(lists) {
  return [...lists].sort((a, b) => {
    const ta = a.expires_at ? new Date(a.expires_at).getTime() || Infinity : Infinity;
    const tb = b.expires_at ? new Date(b.expires_at).getTime() || Infinity : Infinity;
    return ta - tb;
  });
}

/**
 * Generate HTML for a single list row in the sidebar.
 * Pure function — no side effects; used in render and unit tests.
 * @param {{ id: string, name: string, expires_at: string|null, child_count?: number }} l
 * @returns {string}
 */
export function listItemHtml(l) {
  const band = expiryBand(l.expires_at);
  let indicator = '';
  if (Number(l.child_count) > 0) {
    const bandClass = band ? ` sidebar__list-badge--${band}` : '';
    indicator = `<span class="sidebar__list-badge${bandClass}" aria-label="${Number(l.child_count)} sub-listas">${Number(l.child_count)}</span>`;
  } else if (band !== null) {
    indicator = `<span class="sidebar__list-dot sidebar__list-dot--${band}" aria-hidden="true"></span>`;
  }
  return `
    <div class="sidebar__list-item" data-lista-id="${escapeHtml(l.id)}">
      <span class="sidebar__list-item-name">${escapeHtml(l.name)}</span>
      ${indicator}
    </div>
  `;
}
