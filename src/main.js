/**
 * main.js — HKN Lyrics app entry point
 *
 * Initializes theme, store, search index, router, and renders the app shell.
 */

// Styles
import './styles/variables.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/admin.css';

// Modules
import { initTheme } from './components/ThemeToggle.js';
import { initStore, subscribe, getState } from './lib/store.js';
import { buildIndex } from './lib/search.js';
import { route, initRouter, onNotFound, navigate } from './router.js';
import { renderHeader } from './components/Header.js';
import { renderSidebar, toggleSidebar, updateSidebarContent } from './components/Sidebar.js';
import { renderSongList, renderSongListSkeleton } from './components/SongList.js';
import { renderSongView } from './components/SongView.js';
import { renderAdminGate } from './components/AdminGate.js';
import { renderSongEditor } from './components/SongEditor.js';
import { renderAdminDashboard, renderAdminEditList } from './components/AdminDashboard.js';

// Initialize theme immediately to avoid flash
initTheme();

/** @type {HTMLElement} */
let mainContent;

/**
 * Boot the app
 */
async function boot() {
  const app = document.querySelector('#app');
  app.innerHTML = '';

  // Build app shell
  app.innerHTML = `<main class="main"><div class="main__content" id="main-content"></div></main>`;
  mainContent = app.querySelector('#main-content');

  // Render header
  renderHeader(app, {
    onMenuToggle: toggleSidebar,
  });

  // Render sidebar
  renderSidebar(app);

  // Show skeleton while loading
  renderSongListSkeleton(mainContent);

  // Initialize store (loads data + cache)
  await initStore();

  // Build search index
  const { songs } = getState();
  buildIndex(songs);

  // Subscribe to state changes — re-render song list when on home page
  subscribe((state) => {
    buildIndex(state.songs);
    updateSidebarContent();

    const currentHash = window.location.hash.slice(1) || '/';
    if (currentHash === '/' || currentHash === '') {
      renderSongList(mainContent, state.filtered);
    }
  });

  // Setup routes
  route('/', () => {
    const { filtered } = getState();
    renderSongList(mainContent, filtered);
  });

  route('/song/:id', ({ params }) => {
    renderSongView(mainContent, params.id);
  });

  route('/admin', () => {
    renderAdminGate(mainContent, () => {
      renderAdminDashboard(mainContent);
    });
  });

  route('/admin/create', () => {
    renderAdminGate(mainContent, () => {
      renderSongEditor(mainContent);
    });
  });

  route('/admin/edit', () => {
    renderAdminGate(mainContent, () => {
      renderAdminEditList(mainContent);
    });
  });

  route('/admin/edit/:id', ({ params }) => {
    renderAdminGate(mainContent, () => {
      renderSongEditor(mainContent, params.id);
    });
  });

  onNotFound(() => {
    mainContent.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">🤷</div>
        <h2 class="empty-state__title">Página no encontrada</h2>
        <p class="empty-state__text">La ruta que buscas no existe.</p>
        <button class="btn btn--primary" style="margin-top: 1rem;" id="not-found-home">Ir al inicio</button>
      </div>
    `;
    mainContent.querySelector('#not-found-home')?.addEventListener('click', () => navigate('/'));
  });

  // Start router
  initRouter();
}

// Boot on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — app still works
    });
  });
}
