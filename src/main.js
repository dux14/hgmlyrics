/**
 * main.js — HKN Lyrics app entry point
 *
 * Initializes theme, store, search index, router, and renders the app shell.
 */

// Styles (orden de capas centralizado en app.css)
import './styles/app.css';
import './styles/cmdk.css';

// Modules
import { initTheme } from './components/ThemeToggle.js';
import { initStore, subscribe, getState } from './lib/store.js';
import { buildIndex } from './lib/search.js';
import { route, initRouter, onNotFound, navigate, getCurrentPath } from './router.js';
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
import { renderToolsHub } from './components/ToolsHub.js';
import { renderHome } from './components/Home.js';
import { renderBottomNav, updateBottomNavActive } from './components/BottomNav.js';
import { openGoToSheet } from './components/GoToSheet.js';
import { initCommandPalette } from './components/CommandPalette.js';

// Initialize theme immediately to avoid flash
initTheme();

/** @type {HTMLElement} */
let mainContent;

/**
 * Carga weekly_words publicadas para incluirlas en el índice de búsqueda.
 * @returns {Promise<Array>}
 */
async function loadWeeklyWordsForIndex() {
  try {
    const { supabase } = await import('./lib/supabase.js');
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch('/api/weekly-words', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const body = await res.json();
      return body.weeklyWords ?? [];
    }
  } catch (_e) {
    /* ignore */
  }
  return [];
}

/**
 * Boot the app
 */
async function boot() {
  const app = document.querySelector('#app');
  app.innerHTML = '';

  // Build app shell
  app.innerHTML = `<main class="main"><div class="main__content" id="main-content"></div></main>`;
  mainContent = app.querySelector('#main-content');

  // Render header — movil abre la hoja "Ir a…"; desktop conserva la sidebar
  renderHeader(app, {
    onMenuToggle: () =>
      window.matchMedia('(max-width: 767px)').matches
        ? openGoToSheet(getCurrentPath())
        : toggleSidebar(),
  });

  // Render sidebar
  renderSidebar(app);

  // Render filter bar (F4)
  renderFilterBar(app);

  // Bottom-nav móvil (F1b)
  renderBottomNav(app);

  // Command palette desktop-only (Cmd/Ctrl+K) — global, se monta lazy (F1)
  initCommandPalette();

  // Show skeleton while loading
  renderSongListSkeleton(mainContent);

  // Initialize auth FIRST (before any guarded routes resolve).
  await initAuthStore();
  configureAuth({ isAuthenticated, needsOnboarding, isAdmin });

  // Initialize store only if authenticated. If signed out, the authStore subscriber added in Task 20 will clear store state on next sign-in.
  if (isAuthenticated()) {
    await initStore();
    const { songs } = getState();
    const weeklyWords = await loadWeeklyWordsForIndex();
    buildIndex(songs, weeklyWords);
    updateSidebarContent();
    updateFilterBar();
  }

  // Favorites cache — loads once, refreshes on sign-in, clears on sign-out.
  await initFavorites();

  // Subscribe to state changes — re-render song list when on home page
  subscribe(async (state) => {
    const weeklyWords = await loadWeeklyWordsForIndex();
    buildIndex(state.songs, weeklyWords);
    updateSidebarContent();
    updateFilterBar();

    const currentHash = globalThis.location.hash.slice(1) || '/';
    if (currentHash === '/buscar') {
      renderSongList(mainContent, state.filtered);
    } else if (currentHash === '/' || currentHash === '') {
      renderHome(mainContent);
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
    hideFilterBar();
    renderHome(mainContent);
  });

  guardedRoute('/buscar', () => {
    showFilterBar();
    const { filtered } = getState();
    renderSongList(mainContent, filtered);
    document.querySelector('#search-input')?.focus();
  });

  guardedRoute('/herramientas', () => {
    hideFilterBar();
    renderToolsHub(mainContent);
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

  guardedRoute(
    '/admin/voz/nueva',
    async () => {
      hideFilterBar();
      const { renderVozEditor } = await import('./components/VozEditor.js');
      renderVozEditor(mainContent, null);
    },
    { adminOnly: true },
  );

  guardedRoute(
    '/admin/voz/:id',
    async ({ params }) => {
      hideFilterBar();
      const { renderVozEditor } = await import('./components/VozEditor.js');
      renderVozEditor(mainContent, params.id);
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

  guardedRoute('/voces', async () => {
    hideFilterBar();
    const { renderVoicesAlbumView } = await import('./components/VoicesAlbumView.js');
    renderVoicesAlbumView(mainContent);
  });

  guardedRoute('/voz/:id', async ({ params }) => {
    hideFilterBar();
    const { renderWeeklyWordById } = await import('./components/WeeklyWordView.js');
    renderWeeklyWordById(mainContent, params.id);
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

  // Sincronizar tab activo del bottom-nav en cada cambio de ruta (F1b)
  updateBottomNavActive(getCurrentPath());
  window.addEventListener('hashchange', () => updateBottomNavActive(getCurrentPath()));

  // F1: Initialize update notifier
  initUpdateNotifier();

  // Evita evicción del cache offline (clave en iOS pestaña).
  try {
    if (navigator.storage?.persist) {
      const persisted = await navigator.storage.persisted();
      if (!persisted) await navigator.storage.persist();
    }
  } catch (_) { /* no critico */ }

  // F8: Start background caching for all visitors (not only installed PWA)
  try {
    const { startBackgroundCache } = await import('./lib/offlineCache.js');
    startBackgroundCache();
  } catch (_) {
    // offlineCache module not critical
  }

  // PWA: chip global de estado offline
  try {
    const { initOfflineState } = await import('./lib/offlineState.js');
    initOfflineState();
    const { mountOfflineChip } = await import('./components/OfflineChip.js');
    mountOfflineChip();
  } catch (_) {
    // no critico
  }

  // RUM: web-vitals (no bloquea el primer render, import lazy al final del boot)
  try {
    const { initVitals } = await import('./lib/vitals.js');
    initVitals();
  } catch (_) {
    // no critico
  }
}

// Boot on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
