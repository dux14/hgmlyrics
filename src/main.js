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
import './styles/auth.css';

// Modules
import { initTheme } from './components/ThemeToggle.js';
import { initStore, subscribe, getState } from './lib/store.js';
import { buildIndex } from './lib/search.js';
import { route, initRouter, onNotFound, navigate } from './router.js';
import { initAuthStore, isAuthenticated, needsOnboarding, isAdmin } from './lib/authStore.js';
import { initFavorites } from './lib/favorites.js';
import { icon } from './lib/icons.js';
import { configureAuth, guardedRoute } from './router.js';
import { renderLoginPage, renderRegisterPage } from './components/LoginPage.js';
import { renderAuthCallback } from './components/AuthCallback.js';
import { renderOnboardingPage } from './components/OnboardingPage.js';
import { renderProfile } from './components/Profile.js';
import { renderPublicProfile } from './components/PublicProfile.js';
import { renderFriendsPanel } from './components/FriendsPanel.js';
import { renderFavoritesPage } from './components/FavoritesPage.js';
import { renderRecommenderPage } from './components/RecommenderPage.js';
import { renderHeader } from './components/Header.js';
import { renderSidebar, toggleSidebar, updateSidebarContent } from './components/Sidebar.js';
import {
  renderFilterBar,
  updateFilterBar,
  showFilterBar,
  hideFilterBar,
} from './components/FilterBar.js';
import { renderSongList, renderSongListSkeleton } from './components/SongList.js';
import { renderSongView } from './components/SongView.js';
import { renderSongEditor } from './components/SongEditor.js';
import { renderAdminDashboard, renderAdminEditList } from './components/AdminDashboard.js';
import { renderPrayerPage } from './components/PrayerPage.js';
import { renderListDetail } from './components/ListDetail.js';
import { initUpdateNotifier } from './components/UpdateNotifier.js';

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

  // Render filter bar (F4)
  renderFilterBar(app);

  // Show skeleton while loading
  renderSongListSkeleton(mainContent);

  // Initialize auth FIRST (before any guarded routes resolve).
  await initAuthStore();
  configureAuth({ isAuthenticated, needsOnboarding, isAdmin });

  // Initialize store only if authenticated. If signed out, the authStore subscriber added in Task 20 will clear store state on next sign-in.
  if (isAuthenticated()) {
    await initStore();
    const { songs } = getState();
    buildIndex(songs);
    updateSidebarContent();
    updateFilterBar();
  }

  // Favorites cache — loads once, refreshes on sign-in, clears on sign-out.
  await initFavorites();

  // Subscribe to state changes — re-render song list when on home page
  subscribe((state) => {
    buildIndex(state.songs);
    updateSidebarContent();
    updateFilterBar();

    const currentHash = globalThis.location.hash.slice(1) || '/';
    if (currentHash === '/' || currentHash === '') {
      renderSongList(mainContent, state.filtered);
    }
  });

  // ============ Public routes ============
  route('/login', () => {
    hideFilterBar();
    renderLoginPage(mainContent);
  });

  route('/register', () => {
    hideFilterBar();
    renderRegisterPage(mainContent);
  });

  route('/auth/callback', () => {
    hideFilterBar();
    renderAuthCallback(mainContent);
  });

  // ============ Guarded routes ============
  guardedRoute('/onboarding', () => {
    hideFilterBar();
    renderOnboardingPage(mainContent);
  });

  guardedRoute('/', () => {
    showFilterBar();
    const { filtered } = getState();
    renderSongList(mainContent, filtered);
  });

  guardedRoute('/song/:id', ({ params }) => {
    hideFilterBar();
    renderSongView(mainContent, params.id);
  });

  route('/song/:id/links', async ({ params }) => {
    hideFilterBar();
    const { renderSongLinks } = await import('./components/SongLinks.js');
    renderSongLinks(mainContent, params.id);
  });

  guardedRoute(
    '/admin',
    () => {
      hideFilterBar();
      renderAdminDashboard(mainContent);
    },
    { adminOnly: true },
  );

  guardedRoute(
    '/admin/create',
    () => {
      hideFilterBar();
      renderSongEditor(mainContent);
    },
    { adminOnly: true },
  );

  guardedRoute(
    '/admin/edit',
    () => {
      hideFilterBar();
      renderAdminEditList(mainContent);
    },
    { adminOnly: true },
  );

  guardedRoute(
    '/admin/edit/:id',
    ({ params, query }) => {
      hideFilterBar();
      const from = new URLSearchParams(query || '').get('from');
      renderSongEditor(mainContent, params.id, { from });
    },
    { adminOnly: true },
  );

  guardedRoute('/perfil', () => {
    hideFilterBar();
    renderProfile(mainContent);
  });

  guardedRoute('/u/:username', ({ params }) => {
    hideFilterBar();
    renderPublicProfile(mainContent, params.username);
  });

  guardedRoute('/amigos', () => {
    hideFilterBar();
    renderFriendsPanel(mainContent);
  });

  guardedRoute('/favoritos', () => {
    hideFilterBar();
    renderFavoritesPage(mainContent);
  });

  guardedRoute('/afinador', async ({ query }) => {
    hideFilterBar();
    const { renderTuner } = await import('./components/Tuner.js');
    renderTuner(mainContent, { query });
  });

  guardedRoute('/recomendador', () => {
    hideFilterBar();
    renderRecommenderPage(mainContent);
  });

  guardedRoute('/oracion', () => {
    hideFilterBar();
    renderPrayerPage(mainContent);
  });

  guardedRoute('/lista/nueva', () => {
    hideFilterBar();
    renderListDetail(mainContent, null, { mode: 'edit' });
  });

  guardedRoute('/lista/:id', ({ params }) => {
    hideFilterBar();
    renderListDetail(mainContent, params.id, { mode: 'view' });
  });

  guardedRoute('/estudio', async () => {
    hideFilterBar();
    const { renderStudioPage } = await import('./components/StudioPage.js');
    renderStudioPage(mainContent);
  });

  guardedRoute('/licencias', async () => {
    hideFilterBar();
    const { renderLicenses } = await import('./components/LicensesPage.js');
    renderLicenses(mainContent);
  });

  guardedRoute('/mundo', async () => {
    hideFilterBar();
    const { renderWorldPage } = await import('./components/WorldPage.js');
    renderWorldPage(mainContent);
  });

  onNotFound(() => {
    hideFilterBar();
    mainContent.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">${icon('frown', { size: 48 })}</div>
        <h2 class="empty-state__title">Página no encontrada</h2>
        <p class="empty-state__text">La ruta que buscas no existe.</p>
        <button class="btn btn--primary" style="margin-top: 1rem;" id="not-found-home">Ir al inicio</button>
      </div>
    `;
    mainContent.querySelector('#not-found-home')?.addEventListener('click', () => navigate('/'));
  });

  // Start router
  initRouter();

  // F1: Initialize update notifier
  initUpdateNotifier();

  // F8: Start background caching for PWA
  try {
    const { startBackgroundCache, isPWA } = await import('./lib/offlineCache.js');
    if (isPWA()) {
      startBackgroundCache();
    }
  } catch (_) {
    // offlineCache module not critical
  }
}

// Boot on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
