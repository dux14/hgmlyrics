/**
 * router.js — Hash-based SPA router
 *
 * Routes:
 *   #/           → Song list (home)
 *   #/song/:id   → Song view
 *   #/admin      → Admin gate / editor
 */
import { icon } from './lib/icons.js';

/** @type {Map<string, Function>} */
const routes = new Map();
let notFoundHandler = null;
let currentRoute = null;

/**
 * Índice de la entrada actual dentro de la sesión de la app. La entrada de
 * arranque es 0; cada navigate() que empuja una entrada nueva lo incrementa y
 * lo sella en history.state. goBack() lo usa para decidir entre volver una
 * entrada (history.back) o caer al home si ya estamos en la raíz de la sesión.
 * Rastrearlo aquí (y no en history.length) evita salir de la app al hacer
 * "atrás" desde la primera pantalla o desde un deep link.
 */
let historyIndex = 0;

/**
 * Marca que la próxima 'hashchange' proviene de un navigate() con push (no de
 * un atrás/adelante), para contarla en el índice de sesión. Se sella en el
 * handler de hashchange porque el cambio de hash es asíncrono en algunos
 * entornos (jsdom): sellar de forma síncrona apuntaría a la entrada anterior.
 */
let pendingPush = false;

/**
 * Capa "backable" activa: un estado dentro de una pantalla (p. ej. el focus de
 * búsqueda en /buscar) que empuja una entrada de history de la MISMA ruta para
 * que el atrás del navegador la cierre en vez de abandonar la pantalla. Guarda
 * el índice de sesión de su entrada y el callback a ejecutar al cerrarla.
 * @type {{ idx: number, onBack: () => void } | null}
 */
let backable = null;

/**
 * Callbacks a notificar en cada resolve() de ruta (push, replace o popstate),
 * antes de despachar el handler de la ruta destino. A diferencia del patrón
 * local `addEventListener('hashchange', ...)` que usan StudioPage/WorldPage/
 * Tuner/PartituraPage, este hook se dispara también con
 * `navigate(path, { replace: true })` — replaceState no emite 'hashchange',
 * así que ese patrón se lo pierde (bug confirmado: logout y redirects de
 * guardedRoute no limpiaban estado de la ruta anterior). resolve() es el
 * choke-point común a los tres tipos de navegación, por eso es el punto
 * correcto para este hook.
 * @type {Array<() => void>}
 */
let routeChangeListeners = [];

/**
 * Suscribe un callback a cada resolución de ruta (cualquier navegación,
 * incluyendo replace). Úsalo para destruir estado de la pantalla actual antes
 * de que se monte la siguiente. Devuelve una función para desuscribirse.
 * @param {() => void} cb
 * @returns {() => void}
 */
export function onRouteChange(cb) {
  routeChangeListeners.push(cb);
  return () => {
    routeChangeListeners = routeChangeListeners.filter((l) => l !== cb);
  };
}

/** Sella la entrada actual del history con el índice de sesión dado. */
function stampHistory(idx) {
  const prev = window.history.state;
  window.history.replaceState({ ...prev, hknIdx: idx }, '');
}

/**
 * Register a route
 * @param {string} pattern - Route pattern (e.g., '/song/:id')
 * @param {Function} handler - Handler function receiving { params, query }
 */
export function route(pattern, handler) {
  routes.set(pattern, handler);
}

/**
 * Register a 404 handler
 * @param {Function} handler
 */
export function onNotFound(handler) {
  notFoundHandler = handler;
}

/**
 * Navigate to a hash route
 * @param {string} path - e.g., '/song/my-song-id'
 * @param {{ replace?: boolean }} [opts] - replace: usa history.replaceState y
 *   re-resuelve de forma síncrona (no deja la ruta actual en el history).
 */
export function navigate(path, { replace = false } = {}) {
  const currentHash = window.location.hash;
  const targetHash = path.startsWith('#') ? path : `#${path}`;

  if (replace) {
    // Reemplaza la entrada actual (la protegida no queda en el history) y
    // fuerza el re-resolve: replaceState no dispara 'hashchange'.
    // NOTA: re-resolve síncrono — no llamar navigate({ replace }) hacia el mismo
    // destino desde un handler de ruta, o se producirá recursión ilimitada.
    // replace no añade entrada: el índice de sesión no cambia, solo se re-sella.
    window.history.replaceState({ hknIdx: historyIndex }, '', targetHash);
    currentRoute = null;
    resolve();
    return;
  }

  if (currentHash === targetHash) {
    // Hash is already set, hashchange won't fire — force re-resolve
    currentRoute = null;
    resolve();
  } else {
    // Empuja una entrada nueva; el handler de hashchange la sella con el índice
    // siguiente, para que goBack() sepa que hay una pantalla anterior.
    pendingPush = true;
    window.location.hash = path;
  }
}

/**
 * Vuelve a la pantalla inmediatamente anterior dentro de la sesión de la app.
 * Si no hay una (primera pantalla o deep link directo), cae al home en vez de
 * abandonar la app. Es el "atrás" que deben usar los botones "Volver".
 */
export function goBack() {
  if (historyIndex > 0) {
    // El popstate resultante actualiza historyIndex y el hashchange re-renderiza.
    window.history.back();
  } else {
    navigate('/');
  }
}

/**
 * Abre una capa "backable" dentro de la pantalla actual: empuja una entrada de
 * history de la misma ruta (no dispara hashchange ni re-render) para que el
 * atrás del navegador ejecute onBack (cerrar la capa) en vez de salir de la
 * pantalla. Reemplaza cualquier capa previa sin dispararla (p. ej. una que
 * quedó huérfana tras remontar la pantalla).
 * @param {() => void} onBack
 */
export function openBackable(onBack) {
  historyIndex += 1;
  backable = { idx: historyIndex, onBack };
  window.history.pushState({ hknIdx: historyIndex, hknBackable: true }, '', window.location.hash);
}

/**
 * Cierra la capa "backable" activa de forma programática (Escape, botón limpiar)
 * consumiendo su entrada de history, SIN volver a disparar onBack (el cierre
 * visual ya lo hizo el llamador). No-op si no hay capa activa.
 */
export function closeBackable() {
  if (!backable) return;
  backable = null;
  window.history.back();
}

/**
 * Olvida la capa "backable" activa sin tocar el history. Lo llama una pantalla
 * al (re)montarse para descartar una capa huérfana de una instancia anterior.
 */
export function clearBackable() {
  backable = null;
}

/**
 * Get current route path
 * @returns {string}
 */
export function getCurrentPath() {
  const hash = window.location.hash.slice(1) || '/';
  return hash;
}

/**
 * Parse the current hash and match against registered routes
 */
function resolve() {
  const fullPath = getCurrentPath();
  const qIdx = fullPath.indexOf('?');
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);
  const query = qIdx === -1 ? '' : fullPath.slice(qIdx + 1);

  // Prevent re-rendering same route
  if (fullPath === currentRoute) {
    return;
  }
  currentRoute = fullPath;

  for (const cb of routeChangeListeners) cb();

  for (const [pattern, handler] of routes) {
    const params = matchRoute(pattern, path);
    if (params !== null) {
      // Promise.resolve() cubre handlers sync y async por igual. Los handlers
      // lazy (import() dinámico) son async: si el chunk falla — típicamente
      // offline en una ruta cuyos assets no están precacheados — la promesa
      // rechaza. Sin este catch quedaba sin manejar y la pantalla se quedaba
      // con el skeleton de showPageSkeleton() (main.js) para siempre.
      Promise.resolve(handler({ params, path, query })).catch((err) => {
        console.error('Fallo al resolver la ruta:', err);
        renderRouteLoadError();
      });
      return;
    }
  }

  if (notFoundHandler) {
    notFoundHandler({ path });
  }
}

/**
 * Estado de error legible cuando un handler de ruta (típicamente uno lazy,
 * con import() dinámico) rechaza — p. ej. offline en una ruta cuyos chunks no
 * están precacheados. Reemplaza el skeleton colgado por un mensaje con
 * reintento. Mismo patrón visual que renderAsyncRegion()/ListDetail.js
 * (empty-state + [data-retry]).
 */
function renderRouteLoadError() {
  const container = document.getElementById('main-content');
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">${icon('frown', { size: 40 })}</div>
      <h2 class="empty-state__title">No se pudo cargar esta sección</h2>
      <p class="empty-state__text">Revisa tu conexión e inténtalo de nuevo.</p>
      <button class="btn btn--primary" type="button" data-retry>Reintentar</button>
    </div>`;
  container.querySelector('[data-retry]')?.addEventListener('click', () => refresh());
}

/**
 * Match a route pattern against a path
 * @param {string} pattern - e.g., '/song/:id'
 * @param {string} path - e.g., '/song/my-song-id'
 * @returns {object|null} Params or null
 */
function matchRoute(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}

/**
 * Initialize the router — listen for hash changes
 */
export function initRouter() {
  window.addEventListener('hashchange', () => {
    if (pendingPush) {
      // hashchange disparado por un navigate() con push: cuenta como pantalla
      // nueva en la sesión y sella la entrada recién creada con su índice.
      pendingPush = false;
      historyIndex += 1;
      stampHistory(historyIndex);
    }
    currentRoute = null; // Reset to allow re-resolve
    resolve();
  });

  // popstate (atrás/adelante del navegador o gesto nativo): reposiciona el
  // índice de sesión leyéndolo de la entrada a la que aterrizamos. El render lo
  // sigue haciendo el hashchange de arriba; aquí solo se mantiene el índice.
  window.addEventListener('popstate', (e) => {
    if (typeof e.state?.hknIdx === 'number') historyIndex = e.state.hknIdx;
    // Si retrocedimos por debajo de una capa backable activa (atrás nativo desde
    // el focus de búsqueda, etc.), ejecuta su cierre y descártala.
    if (backable && historyIndex < backable.idx) {
      const { onBack } = backable;
      backable = null;
      onBack();
    }
  });

  // Sella la entrada de arranque como raíz de la sesión (índice 0). Un deep link
  // directo también arranca en 0 → goBack cae al home, no fuera de la app.
  historyIndex = 0;
  stampHistory(0);

  // Un refresh() temprano (p. ej. SIGNED_OUT durante el boot, antes de registrar
  // rutas) puede dejar currentRoute apuntando al hash sin que la ruta se haya
  // renderizado; se descarta para que el resolve inicial no haga early-return.
  currentRoute = null;

  // Initial resolve
  resolve();
}

/**
 * Force re-resolve the current route
 */
export function refresh() {
  currentRoute = null;
  resolve();
}

// ============================================================
// Auth-aware route guarding (adapter pattern to avoid circular import)
// ============================================================

/** @type {{ isAuthenticated: () => boolean, needsOnboarding: () => boolean, isAdmin: () => boolean } | null} */
let authAdapter = null;

/**
 * Configure the auth adapter used by guardedRoute().
 * Must be called before registering guarded routes.
 * @param {object} adapter
 * @param {() => boolean} adapter.isAuthenticated
 * @param {() => boolean} adapter.needsOnboarding
 * @param {() => boolean} adapter.isAdmin
 */
export function configureAuth(adapter) {
  authAdapter = adapter;
}

/**
 * Register a route that requires authentication.
 * Behavior:
 *  - Not authenticated → navigate to /login?next=<path>
 *  - Onboarding needed → navigate to /onboarding (unless path === /onboarding)
 *  - adminOnly + !isAdmin → navigate to /
 * @param {string} pattern
 * @param {Function} handler
 * @param {object} [opts]
 * @param {boolean} [opts.adminOnly=false]
 */
export function guardedRoute(pattern, handler, { adminOnly = false } = {}) {
  route(pattern, ({ params, path, query }) => {
    if (!authAdapter) {
      console.error('guardedRoute called before configureAuth');
      return;
    }
    if (!authAdapter.isAuthenticated()) {
      // replace: la ruta protegida no debe quedar en el history (back-trap).
      navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
      return;
    }
    if (authAdapter.needsOnboarding() && path !== '/onboarding') {
      navigate('/onboarding');
      return;
    }
    if (adminOnly && !authAdapter.isAdmin()) {
      navigate('/');
      return;
    }
    // Forward query too — handlers como /afinador leen ?mode/?ref/?songId/?from.
    handler({ params, path, query });
  });
}
