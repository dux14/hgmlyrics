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
 */
export function navigate(path) {
  window.location.hash = path;
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
  const path = getCurrentPath();

  // Prevent re-rendering same route
  if (path === currentRoute) {
    return;
  }
  currentRoute = path;

  for (const [pattern, handler] of routes) {
    const params = matchRoute(pattern, path);
    if (params !== null) {
      handler({ params, path });
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
