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
import { renderProfile, renderProfileEdit } from './components/Profile.js';
import { renderPublicProfile } from './components/PublicProfile.js';
import { renderFriendsPanel } from './components/FriendsPanel.js';
import { renderFavoritesPage } from './components/FavoritesPage.js';
import { renderRecommenderPage } from './components/RecommenderPage.js';
import { renderHeader } from './components/Header.js';
import { renderSidebar, toggleSidebar, updateSidebarContent } from './components/Sidebar.js';
import {
  renderFilterBar,
  updateFilterBar,
  hideFilterBar,
} from './components/FilterBar.js';
import { renderSongListSkeleton } from './components/SongList.js';
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

  // Shortcut global Cmd/Ctrl+K — abre SearchFocus (reemplaza al CommandPalette)
  document.addEventListener('keydown', async (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const { openSearchFocus } = await import('./components/SearchFocus.js');
      openSearchFocus();
    }
  });

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
      const { renderSearchPage } = await import('./components/SearchPage.js');
      await renderSearchPage(mainContent, weeklyWords);
    } else if (currentHash === '/' || currentHash === '') {
      renderHome(mainContent);
    }
  });

  // ============ Public routes ============
  // Wrapper: marca rutas privadas/guardadas quitando la clase de shell oculto
  // y la clase de bleed del browse hub (se vuelve a añadir solo en /buscar).
  const privateRoute = (path, cb, opts) =>
    guardedRoute(
      path,
      (...args) => {
        document.body.classList.remove('auth-route');
        document.querySelector('.main')?.classList.remove('main--bleed');
        return cb(...args);
      },
      opts,
    );

  route('/login', () => {
    hideFilterBar();
    document.querySelector('.main')?.classList.remove('main--bleed');
    document.body.classList.add('auth-route');
    renderLoginPage(mainContent);
  });

  route('/register', () => {
    hideFilterBar();
    document.querySelector('.main')?.classList.remove('main--bleed');
    document.body.classList.add('auth-route');
    renderRegisterPage(mainContent);
  });

  route('/auth/callback', () => {
    hideFilterBar();
    document.querySelector('.main')?.classList.remove('main--bleed');
    document.body.classList.add('auth-route');
    renderAuthCallback(mainContent);
  });

  // ============ Guarded routes ============
  privateRoute('/onboarding', () => {
    hideFilterBar();
    renderOnboardingPage(mainContent);
  });

  privateRoute('/', () => {
    hideFilterBar();
    renderHome(mainContent);
  });

  privateRoute('/buscar', async () => {
    hideFilterBar();
    const { renderSearchPage } = await import('./components/SearchPage.js');
    const weeklyWords = await loadWeeklyWordsForIndex();
    // Añadir el bleed justo antes de montar el contenido nuevo: si se añadiera
    // antes de los await, el contenido de la ruta anterior (aún montado) perdería
    // su gutter y se vería expandirse edge-to-edge durante todo el fetch.
    document.querySelector('.main')?.classList.add('main--bleed');
    await renderSearchPage(mainContent, weeklyWords);
  });

  privateRoute('/herramientas', () => {
    hideFilterBar();
    renderToolsHub(mainContent);
  });

  privateRoute('/song/:id', ({ params }) => {
    hideFilterBar();
    renderSongView(mainContent, params.id);
  });

  route('/song/:id/links', async ({ params }) => {
    hideFilterBar();
    document.body.classList.remove('auth-route');
    const { renderSongLinks } = await import('./components/SongLinks.js');
    renderSongLinks(mainContent, params.id);
  });

  privateRoute(
    '/admin',
    () => {
      hideFilterBar();
      renderAdminDashboard(mainContent);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/create',
    () => {
      hideFilterBar();
      renderSongEditor(mainContent);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/edit',
    () => {
      hideFilterBar();
      renderAdminEditList(mainContent);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/edit/:id',
    ({ params, query }) => {
      hideFilterBar();
      const from = new URLSearchParams(query || '').get('from');
      renderSongEditor(mainContent, params.id, { from });
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/voz/nueva',
    async () => {
      hideFilterBar();
      const { renderVozEditor } = await import('./components/VozEditor.js');
      renderVozEditor(mainContent, null);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/voz/:id',
    async ({ params }) => {
      hideFilterBar();
      const { renderVozEditor } = await import('./components/VozEditor.js');
      renderVozEditor(mainContent, params.id);
    },
    { adminOnly: true },
  );

  privateRoute('/perfil', () => {
    hideFilterBar();
    renderProfile(mainContent);
  });

  privateRoute('/perfil/editar', () => {
    hideFilterBar();
    renderProfileEdit(mainContent);
  });

  privateRoute('/u/:username', ({ params }) => {
    hideFilterBar();
    renderPublicProfile(mainContent, params.username);
  });

  privateRoute('/amigos', () => {
    hideFilterBar();
    renderFriendsPanel(mainContent);
  });

  privateRoute('/favoritos', () => {
    hideFilterBar();
    renderFavoritesPage(mainContent);
  });

  privateRoute('/afinador', async ({ query }) => {
    hideFilterBar();
    const { renderTuner } = await import('./components/Tuner.js');
    renderTuner(mainContent, { query });
  });

  privateRoute('/recomendador', () => {
    hideFilterBar();
    renderRecommenderPage(mainContent);
  });

  privateRoute('/oracion', () => {
    hideFilterBar();
    renderPrayerPage(mainContent);
  });

  privateRoute('/voces', async () => {
    hideFilterBar();
    const { renderVoicesAlbumView } = await import('./components/VoicesAlbumView.js');
    renderVoicesAlbumView(mainContent);
  });

  privateRoute('/albumes', async () => {
    hideFilterBar();
    const { renderAlbumsView } = await import('./components/AlbumsView.js');
    renderAlbumsView(mainContent);
  });

  privateRoute('/album/:id', async ({ params }) => {
    hideFilterBar();
    const { renderAlbumDetail } = await import('./components/AlbumDetail.js');
    renderAlbumDetail(mainContent, params.id);
  });

  privateRoute('/voz/:id', async ({ params }) => {
    hideFilterBar();
    const { renderWeeklyWordById } = await import('./components/WeeklyWordView.js');
    renderWeeklyWordById(mainContent, params.id);
  });

  privateRoute('/lista/nueva', () => {
    hideFilterBar();
    renderListDetail(mainContent, null, { mode: 'edit' });
  });

  privateRoute('/lista/:id', ({ params }) => {
    hideFilterBar();
    renderListDetail(mainContent, params.id, { mode: 'view' });
  });

  privateRoute('/estudio', async () => {
    hideFilterBar();
    const { renderStudioPage } = await import('./components/StudioPage.js');
    renderStudioPage(mainContent);
  });

  privateRoute('/licencias', async () => {
    hideFilterBar();
    const { renderLicenses } = await import('./components/LicensesPage.js');
    renderLicenses(mainContent);
  });

  privateRoute('/mundo', async () => {
    hideFilterBar();
    const { renderWorldPage } = await import('./components/WorldPage.js');
    renderWorldPage(mainContent);
  });

  onNotFound(() => {
    hideFilterBar();
    document.body.classList.remove('auth-route');
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
