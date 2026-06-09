/**
 * authStore.js — central auth state with pub/sub.
 *
 * Mirrors the pattern from store.js: getXxx() snapshots, subscribe(fn),
 * mutations only via exported actions. Wraps supabase.auth.onAuthStateChange.
 */
import { supabase } from './supabase.js';
// Sin ciclo: router.js nunca importa authStore (usa el adapter de configureAuth).
import { refresh } from '../router.js';

const state = {
  session: null,
  profile: null,
  flags: [],
  listeners: new Set(),
};

function notify() {
  const snap = { session: state.session, profile: state.profile };
  state.listeners.forEach((fn) => fn(snap));
}

/**
 * Subscribe to auth state changes.
 * @param {(snapshot: {session: object|null, profile: object|null}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function getSession() {
  return state.session;
}

export function getProfile() {
  return state.profile;
}

export function isAuthenticated() {
  return !!state.session;
}

export function isAdmin() {
  return !!state.profile?.isAdmin;
}

export function needsOnboarding() {
  return !!state.session && !!state.profile && !state.profile.username;
}

/**
 * Fetch /api/auth/me and cache the profile.
 */
export async function refreshProfile() {
  if (!state.session) {
    state.profile = null;
    state.flags = [];
    return;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${state.session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      state.profile = data.profile;
      state.flags = Array.isArray(data.flags) ? data.flags : [];
    } else {
      state.profile = null;
      state.flags = [];
    }
  } catch (e) {
    console.warn('refreshProfile failed', e);
    state.profile = null;
    state.flags = [];
  }
}

/**
 * Bootstrap: read current session, fetch profile, subscribe to changes.
 */
export async function initAuthStore() {
  // If the URL has ?code= (magic link / OAuth callback), exchange it explicitly
  // BEFORE getSession so the router resolves with a valid session.
  const url = new URL(globalThis.location.href);
  const code = url.searchParams.get('code');
  if (code) {
    try {
      await supabase.auth.exchangeCodeForSession(code);
      url.searchParams.delete('code');
      const cleanSearch = url.searchParams.toString();
      const cleanHref = url.pathname + (cleanSearch ? '?' + cleanSearch : '') + (url.hash || '');
      globalThis.history.replaceState(null, '', cleanHref);
    } catch (e) {
      console.warn('exchangeCodeForSession failed', e);
    }
  }

  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  if (state.session) await refreshProfile();

  supabase.auth.onAuthStateChange(async (event, session) => {
    state.session = session;
    if (session) {
      await refreshProfile();
    } else {
      state.profile = null;
      state.flags = [];
    }
    notify();
    if (event === 'SIGNED_OUT') {
      // El router solo reacciona a hashchange y no "ve" los cambios de auth:
      // cualquier cierre de sesión (multi-pestaña, expiración, signOut tardío)
      // debe re-evaluar el guard de la ruta visible. refresh() fuerza el
      // re-resolve y el guard patea a /login con replace si la ruta era protegida.
      refresh();
    }
  });
}

/** @param {string} key @returns {boolean} */
export function isFeatureEnabled(key) {
  return state.flags.includes(key);
}

/** Solo para tests. */
export function __setFlagsForTest(flags) {
  state.flags = Array.isArray(flags) ? flags : [];
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: globalThis.location.origin + '/#/auth/callback' },
  });
}

export async function signInWithMagicLink(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: globalThis.location.origin + '/#/auth/callback' },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}
