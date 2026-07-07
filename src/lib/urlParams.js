/**
 * urlParams.js — helpers de query param compartidos entre AuthCallback.js y
 * LoginPage.js. isSafeRedirect es lógica adyacente a seguridad (evita open
 * redirects): vive junto a getNextParam para no duplicarla entre ambos.
 */

/**
 * Lee ?next= del query dentro del hash (p. ej. `#/login?next=/perfil`).
 * @returns {string|null}
 */
export function getNextParam() {
  const hash = globalThis.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get('next');
}

/**
 * Returns true only for relative internal paths.
 * Rejects //evil.com and /\evil open-redirect patterns.
 * @param {string|null} next
 * @returns {boolean}
 */
export function isSafeRedirect(next) {
  return (
    typeof next === 'string' &&
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.startsWith('/\\')
  );
}
