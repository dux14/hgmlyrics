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
import {
  route,
  initRouter,
  onNotFound,
  navigate,
  getCurrentPath,
  onRouteChange,
} from './router.js';
import { initAuthStore, isAuthenticated, needsOnboarding, isAdmin } from './lib/authStore.js';
import { initFavorites } from './lib/favorites.js';
import { initRecentVisits } from './lib/recentVisits.js';
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
import { renderHeader, hideHeader, showHeader } from './components/Header.js';
import { renderSidebar, updateSidebarContent } from './components/Sidebar.js';
import { renderSongListSkeleton } from './components/SongList.js';
import { skelLongText } from './lib/skeleton.js';
import { renderSongView } from './components/SongView.js';
import { renderSongEditor } from './components/SongEditor.js';
import { renderAdminDashboard, renderAdminEditList } from './components/AdminDashboard.js';
import { renderPrayerPage } from './components/PrayerPage.js';
import { renderListDetail } from './components/ListDetail.js';
import { initUpdateNotifier } from './components/UpdateNotifier.js';
import { renderToolsHub } from './components/ToolsHub.js';
import { renderHome } from './components/Home.js';
import { renderBottomNav, updateBottomNavActive } from './components/BottomNav.js';
import { closeGoToSheet } from './components/GoToSheet.js';
import { getWeeklyWords, warmWeeklyWords } from './lib/weeklyWords.js';
import { initChromeAutoHide, setChromeAutoHide } from './lib/scrollChrome.js';

// Motor único de auto-hide por ruta: Grupo C = header + nav; Grupo B = solo
// nav, headerless (hero a sangre completa, sin header ni su reserva de
// espacio). `headerless: true` unifica lo que antes era la tabla HEADERLESS
// aparte — es exactamente el subconjunto nav-only de esta tabla.
const CHROME_AUTOHIDE = [
  { re: /^\/$/, header: true, nav: true },
  { re: /^\/favoritos$/, header: true, nav: true },
  { re: /^\/listas$/, header: true, nav: true },
  { re: /^\/albumes$/, header: true, nav: true },
  { re: /^\/amigos$/, header: true, nav: true },
  { re: /^\/licencias$/, header: true, nav: true },
  { re: /^\/lista\/(?!nueva$)[^/]+$/, header: true, nav: true }, // vista, no editor
  { re: /^\/oracion$/, header: true, nav: true },
  { re: /^\/song\/[^/]+$/, header: true, nav: true }, // no incluye /song/:id/links
  { re: /^\/album\/[^/]+$/, nav: true, headerless: true },
  { re: /^\/u\/[^/]+$/, header: true, nav: true },
  { re: /^\/voz\/[^/]+$/, header: true, nav: true },
  { re: /^\/voces$/, nav: true, headerless: true },
  { re: /^\/perfil$/, header: true, nav: true }, // no incluye /perfil/editar
];
const chromeFor = (path) => CHROME_AUTOHIDE.find((c) => c.re.test(path)) ?? {};
const isHeaderless = (path) => Boolean(chromeFor(path).headerless);

// Initialize theme immediately to avoid flash
initTheme();

/** @type {HTMLElement} */
let mainContent;

/**
 * Skeleton neutro instantáneo para rutas con import() diferido. Se pinta de
 * forma síncrona ANTES de esperar el chunk para que la navegación no deje la
 * pantalla anterior visible bajo la URL ya cambiada (el módulo repinta su
 * propio shell al resolver el import).
 */
function showPageSkeleton() {
  if (mainContent) mainContent.innerHTML = skelLongText();
}

/**
 * Carga weekly_words publicadas para incluirlas en el índice de búsqueda.
 * Fuente única SWR: `getWeeklyWords()` (fetch autenticado + cache compartida).
 * @returns {Promise<Array>}
 */
async function loadWeeklyWordsForIndex() {
  try {
    return await getWeeklyWords();
  } catch (_e) {
    return [];
  }
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

  // Render header — logo + oración + tema + avatar. La navegación por menú
  // vive en el footer (móvil, hoja "Ir a…") y en la sidebar (desktop).
  renderHeader(app);

  // Render sidebar
  renderSidebar(app);

  // Bottom-nav móvil (F1b)
  renderBottomNav(app);

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
  }

  // Favoritos (cache en memoria) y recientes ligados a la cuenta (merge
  // local+servidor). Independientes entre sí: en paralelo para no sumar
  // round-trips al arranque.
  await Promise.all([initFavorites(), initRecentVisits()]);

  // Subscribe to state changes — re-render song list when on home page
  subscribe(async (state) => {
    const weeklyWords = await loadWeeklyWordsForIndex();
    buildIndex(state.songs, weeklyWords);
    updateSidebarContent();

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
        // Rutas con carga diferida (handler async → await import): pinta un
        // skeleton al instante para que la pantalla anterior no quede visible
        // bajo la URL nueva mientras se resuelve el chunk. Las síncronas ya
        // pintan su propio shell de inmediato, así que no lo necesitan.
        if (cb.constructor.name === 'AsyncFunction') showPageSkeleton();
        return cb(...args);
      },
      opts,
    );

  route('/login', () => {
    document.querySelector('.main')?.classList.remove('main--bleed');
    document.body.classList.add('auth-route');
    renderLoginPage(mainContent);
  });

  route('/register', () => {
    document.querySelector('.main')?.classList.remove('main--bleed');
    document.body.classList.add('auth-route');
    renderRegisterPage(mainContent);
  });

  route('/auth/callback', () => {
    document.querySelector('.main')?.classList.remove('main--bleed');
    document.body.classList.add('auth-route');
    renderAuthCallback(mainContent);
  });

  // ============ Guarded routes ============
  privateRoute('/onboarding', () => {
    renderOnboardingPage(mainContent);
  });

  privateRoute('/', () => {
    renderHome(mainContent);
  });

  privateRoute('/buscar', async () => {
    const { renderSearchPage } = await import('./components/SearchPage.js');
    // El bleed se añade justo antes de montar el contenido nuevo para que la ruta
    // anterior no pierda su gutter durante el import dinamico.
    document.querySelector('.main')?.classList.add('main--bleed');
    // Ya no se hace await de /api/weekly-words aqui: renderSearchPage pinta el shell
    // al instante y la seccion "Voces en off" carga en su propia region async.
    await renderSearchPage(mainContent);
  });

  privateRoute('/herramientas', () => {
    renderToolsHub(mainContent);
  });

  privateRoute('/song/:id', ({ params }) => {
    renderSongView(mainContent, params.id);
  });

  route('/song/:id/links', async ({ params }) => {
    document.body.classList.remove('auth-route');
    showPageSkeleton();
    const { renderSongLinks } = await import('./components/SongLinks.js');
    renderSongLinks(mainContent, params.id);
  });

  privateRoute(
    '/admin',
    () => {
      renderAdminDashboard(mainContent);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/create',
    () => {
      renderSongEditor(mainContent);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/edit',
    () => {
      renderAdminEditList(mainContent);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/edit/:id',
    ({ params, query }) => {
      const from = new URLSearchParams(query || '').get('from');
      renderSongEditor(mainContent, params.id, { from });
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/voz/nueva',
    async () => {
      const { renderVozEditor } = await import('./components/VozEditor.js');
      renderVozEditor(mainContent, null);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/voz/:id',
    async ({ params }) => {
      const { renderVozEditor } = await import('./components/VozEditor.js');
      renderVozEditor(mainContent, params.id);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/flags',
    async () => {
      const { renderAdminFlagsPage } = await import('./components/AdminFlagsPage.js');
      renderAdminFlagsPage(mainContent);
    },
    { adminOnly: true },
  );

  privateRoute(
    '/admin/mundo',
    async () => {
      const { renderAdminWorldPage } = await import('./components/AdminWorldPage.js');
      renderAdminWorldPage(mainContent);
    },
    { adminOnly: true },
  );

  privateRoute('/perfil', () => {
    renderProfile(mainContent);
  });

  privateRoute('/perfil/editar', () => {
    renderProfileEdit(mainContent);
  });

  privateRoute('/u/:username', ({ params }) => {
    renderPublicProfile(mainContent, params.username);
  });

  privateRoute('/amigos', () => {
    renderFriendsPanel(mainContent);
  });

  privateRoute('/favoritos', () => {
    renderFavoritesPage(mainContent);
  });

  privateRoute('/afinador', async ({ query }) => {
    const { renderTuner } = await import('./components/Tuner.js');
    renderTuner(mainContent, { query });
  });

  privateRoute('/recomendador', () => {
    renderRecommenderPage(mainContent);
  });

  privateRoute('/oracion', () => {
    renderPrayerPage(mainContent);
  });

  privateRoute('/voces', async () => {
    const { renderVoicesAlbumView } = await import('./components/VoicesAlbumView.js');
    renderVoicesAlbumView(mainContent);
  });

  privateRoute('/albumes', async () => {
    const { renderAlbumsView } = await import('./components/AlbumsView.js');
    renderAlbumsView(mainContent);
  });

  privateRoute('/listas', async () => {
    const { renderListsPage } = await import('./components/ListsPage.js');
    await renderListsPage(mainContent);
  });

  privateRoute('/album/:id', async ({ params }) => {
    const { renderAlbumDetail } = await import('./components/AlbumDetail.js');
    renderAlbumDetail(mainContent, params.id);
  });

  privateRoute('/voz/:id', async ({ params }) => {
    const { renderWeeklyWordById } = await import('./components/WeeklyWordView.js');
    renderWeeklyWordById(mainContent, params.id);
  });

  privateRoute('/lista/nueva', () => {
    renderListDetail(mainContent, null, { mode: 'edit' });
  });

  privateRoute('/lista/:id', ({ params }) => {
    renderListDetail(mainContent, params.id, { mode: 'view' });
  });

  privateRoute('/estudio', async () => {
    const { renderStudioPage } = await import('./components/StudioPage.js');
    renderStudioPage(mainContent);
  });

  privateRoute('/partitura', async () => {
    const { renderPartituraPage } = await import('./components/PartituraPage.js');
    renderPartituraPage(mainContent);
  });

  privateRoute('/licencias', async () => {
    const { renderLicenses } = await import('./components/LicensesPage.js');
    renderLicenses(mainContent);
  });

  privateRoute('/mundo', async () => {
    const { renderWorldPage } = await import('./components/WorldPage.js');
    renderWorldPage(mainContent);
  });

  onNotFound(() => {
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

  // Motor único de auto-hide de header + bottom-nav (chrome sin fin, Task 2).
  // Debe engancharse ANTES de la suscripción de abajo: esta llama a
  // setChromeAutoHide ya en el resolve() inicial de initRouter().
  initChromeAutoHide({
    headerEl: document.getElementById('app-header'),
    navEl: document.querySelector('.bottom-nav'),
  });

  // Decide header, tab activo del bottom-nav y política de auto-hide en CADA
  // resolución de ruta (push, replace o popstate) — no solo 'hashchange', que
  // replaceState no dispara (dejaba el header desincronizado tras
  // navigate(path, { replace: true }): SearchPage a /song/:id o /voz/:id,
  // Profile.js/AuthButton.js a /login al salir de /perfil). Se registra ANTES
  // de initRouter() para que el resolve() inicial del arranque ya lo cubra
  // (deep link directo a una ruta headerless del Grupo B), sin necesitar una
  // llamada de arranque aparte.
  onRouteChange(() => {
    closeGoToSheet(); // cierra la hoja "Ir a" al navegar (incl. botón atrás)
    const path = getCurrentPath();
    updateBottomNavActive(path);
    isHeaderless(path) ? hideHeader() : showHeader();
    setChromeAutoHide(chromeFor(path));
  });

  // Start router (dispara el resolve() inicial, ya cubierto por la suscripción de arriba).
  initRouter();

  // F1: Initialize update notifier
  initUpdateNotifier();

  // Evita evicción del cache offline (clave en iOS pestaña).
  try {
    if (navigator.storage?.persist) {
      const persisted = await navigator.storage.persisted();
      if (!persisted) await navigator.storage.persist();
    }
  } catch (_) {
    /* no critico */
  }

  // F8: Start background caching for all visitors (not only installed PWA)
  try {
    const { startBackgroundCache } = await import('./lib/offlineCache.js');
    startBackgroundCache();
  } catch (_) {
    // offlineCache module not critical
  }

  // Precalienta weekly-words en idle solo si hay sesion (el endpoint exige auth).
  if (isAuthenticated()) warmWeeklyWords();

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
