/**
 * AuthCallback.js — handler de #/auth/callback?code=...
 *
 * initAuthStore() ya ejecutó exchangeCodeForSession antes de que el router
 * llegara acá (boot lo awaitea). Si tenemos sesión seguimos al onboarding/home;
 * si no, regresamos a /login con el motivo del fallo si vino en la URL.
 */
import { getSession, needsOnboarding } from '../lib/authStore.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';

function getNextParam() {
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

/**
 * Render the auth callback screen.
 * @param {HTMLElement} container
 */
export async function renderAuthCallback(container) {
  container.innerHTML = `
    <div class="auth-page fade-in">
      <div class="auth-card auth-offline">
        <div style="color: var(--color-text-secondary);">${icon('music', { size: 48, className: 'loading-pulse' })}</div>
        <p class="auth-subtitle">Iniciando sesión...</p>
      </div>
    </div>
  `;

  if (!getSession()) {
    navigate('/login');
    return;
  }

  if (needsOnboarding()) {
    navigate('/onboarding');
    return;
  }

  const next = getNextParam();
  navigate(isSafeRedirect(next) ? next : '/');
}
