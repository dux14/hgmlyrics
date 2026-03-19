/**
 * Sidebar.js — Sidebar component
 *
 * Album filters, sorting options, voice type filters.
 * Overlay on mobile, fixed panel on desktop.
 */

import { getAlbums, filterByAlbum, setSortMode, filterByVoice, getState, getVoiceTypes } from '../lib/store.js';

const VOICE_LABELS = {
  male: '♂ Masculina',
  female: '♀ Femenina',
  mixed: '⚥ Mixta'
};

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
  const { activeAlbum, sortMode, voiceFilter } = getState();

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

    <!-- Sort Section -->
    <div class="sidebar__section" id="sidebar-sort">
      <div class="sidebar__section-title" data-section="sort">
        Ordenar por
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="sidebar__section-content">
        <button class="sidebar__sort-btn ${sortMode === 'a-z' ? 'active' : ''}" data-sort="a-z">A → Z</button>
        <button class="sidebar__sort-btn ${sortMode === 'z-a' ? 'active' : ''}" data-sort="z-a">Z → A</button>
        <button class="sidebar__sort-btn ${sortMode === 'recent' ? 'active' : ''}" data-sort="recent">Más recientes</button>
        <button class="sidebar__sort-btn ${sortMode === 'album' ? 'active' : ''}" data-sort="album">Por álbum</button>
      </div>
    </div>

    <!-- Voice Filter Section -->
    <div class="sidebar__section" id="sidebar-voice">
      <div class="sidebar__section-title" data-section="voice">
        Tipo de voz
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="sidebar__section-content">
        <button class="sidebar__sort-btn ${!voiceFilter ? 'active' : ''}" data-voice="">Todas</button>
        ${getVoiceTypes().map((type) => `
          <button class="sidebar__sort-btn ${voiceFilter === type ? 'active' : ''}" data-voice="${type}">
            ${VOICE_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        `).join('')}
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

      // Close sidebar on mobile after selecting
      if (window.innerWidth < 768) {
        closeSidebar();
      }
    });
  });

  // Sort mode
  sidebarEl.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setSortMode(btn.dataset.sort);
      updateSidebarContent();
    });
  });

  // Voice filter
  sidebarEl.querySelectorAll('[data-voice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterByVoice(btn.dataset.voice || null);
      updateSidebarContent();
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
