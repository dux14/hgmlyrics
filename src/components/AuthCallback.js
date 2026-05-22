/**
 * AuthCallback.js — handler de #/auth/callback?code=...
 *
 * Supabase-js (detectSessionInUrl: true) ya intercambia el code en getSession().
 * Esto significa que cuando llegamos aquí, la sesión ya está activa.
 * Solo necesitamos redirigir a next/onboarding/home.
 */
import { supabase } from '../lib/supabase.js';
import { refreshProfile, getSession, needsOnboarding } from '../lib/authStore.js';
import { navigate } from '../router.js';

function getNextParam() {
  // Hash routes pueden traer ?next=... después del path: /#/auth/callback?next=/song/x
  const hash = globalThis.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get('next');
}

/**
 * Render the auth callback screen.
 * @param {HTMLElement} container
 */
export async function renderAuthCallback(container) {
  container.innerHTML = `
    <div class="auth-page fade-in">
      <div class="auth-card auth-offline">
        <div style="font-size:48px;">⏳</div>
        <p class="auth-subtitle">Iniciando sesión...</p>
      </div>
    </div>
  `;

  // supabase-js handles ?code= automatically via detectSessionInUrl.
  // Wait for session to be available (poll briefly if not yet).
  let attempts = 0;
  while (!getSession() && attempts < 20) {
    await new Promise((r) => setTimeout(r, 100));
    attempts++;
  }

  if (!getSession()) {
    // Try explicit exchange (covers some edge cases)
    const url = new URL(globalThis.location.href);
    const code =
      url.searchParams.get('code') ||
      new URLSearchParams(globalThis.location.hash.split('?')[1] || '').get('code');
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    }
  }

  if (!getSession()) {
    navigate('/login');
    return;
  }

  await refreshProfile();

  if (needsOnboarding()) {
    navigate('/onboarding');
    return;
  }

  const next = getNextParam();
  navigate(next && next.startsWith('/') ? next : '/');
}
