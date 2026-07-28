/**
 * AuthCallback.js — handler de #/auth/callback?code=...
 *
 * initAuthStore() ya ejecutó exchangeCodeForSession antes de que el router
 * llegara aquí (boot lo awaitea). Si tenemos sesión seguimos al onboarding/home;
 * si no, regresamos a /login con el motivo del fallo si vino en la URL.
 */
import { getSession, needsOnboarding } from '../lib/authStore.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';
import { getNextParam, isSafeRedirect } from '../lib/urlParams.js';

// Re-export por compatibilidad: isSafeRedirect vivía aquí antes de moverse a
// lib/urlParams.js (T3 quality review); queda disponible para quien todavía
// la importe desde este módulo.
export { isSafeRedirect };

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
