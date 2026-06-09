/**
 * router.js — Hash-based SPA router
 *
 * Routes:
 *   #/           → Song list (home)
 *   #/song/:id   → Song view
 *   #/admin      → Admin gate / editor
 */

/** @type {Map<string, Function>} */
const routes = new Map();
let notFoundHandler = null;
let currentRoute = null;

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
    window.history.replaceState(null, '', targetHash);
    currentRoute = null;
    resolve();
    return;
  }

  if (currentHash === targetHash) {
    // Hash is already set, hashchange won't fire — force re-resolve
    currentRoute = null;
    resolve();
  } else {
    window.location.hash = path;
  }
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

  for (const [pattern, handler] of routes) {
    const params = matchRoute(pattern, path);
    if (params !== null) {
      handler({ params, path, query });
      return;
    }
  }

  if (notFoundHandler) {
    notFoundHandler({ path });
  }
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
    currentRoute = null; // Reset to allow re-resolve
    resolve();
  });

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
      navigate(`/login?next=${encodeURIComponent(path)}`);
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
