/**
 * Sidebar.js — Sidebar component
 *
 * Album filters only (sort and voice moved to FilterBar).
 * Overlay on mobile, fixed panel on desktop.
 */

import { getAlbums, filterByAlbum, getState } from '../lib/store.js';
import { navigate } from '../router.js';

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
          <span>🎵</span>
          <span>Todas las canciones</span>
        </div>
        ${albums
          .map(
            (album) => {
              const coverUrl = album.coverImage.startsWith('/') || album.coverImage.startsWith('http')
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
            }
          )
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
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
