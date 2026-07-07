/**
 * authStore.js — central auth state with pub/sub.
 *
 * Mirrors the pattern from store.js: getXxx() snapshots, subscribe(fn),
 * mutations only via exported actions. Wraps supabase.auth.onAuthStateChange.
 */
import { supabase } from './supabase.js';
// Sin ciclo: router.js nunca importa authStore (usa el adapter de configureAuth).
import { refresh, getCurrentPath } from '../router.js';

const state = {
  session: null,
  profile: null,
  flags: [],
  // true cuando getSession() devolvió null en boot pero hay un refresh token
  // persistido: la app es offline-first, así que dejamos pasar el guard con
  // datos de caché mientras se reintenta el refresh en background (T1).
  pendingSession: false,
  listeners: new Set(),
};

/**
 * Un solo reintento de recheck tras SIGNED_OUT (T2). Evita loops si llegan
 * varios SIGNED_OUT en cascada del mismo episodio (p. ej. rotación de token
 * fallida en varias pestañas). Se resetea cuando vuelve a haber sesión.
 */
let signOutRecheckAttempted = false;

const PROFILE_CACHE_KEY = 'hkn-profile-cache';
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];
let retryTimeoutId = null;
let retryStep = 0;

/** Deriva la key de storage de auth-js (`sb-<ref>-auth-token`) desde la URL de Supabase. */
function getAuthStorageKey() {
  const url = import.meta.env.VITE_SUPABASE_URL || '';
  const match = url.match(/^https:\/\/([^.]+)\.supabase\.co/);
  return match ? `sb-${match[1]}-auth-token` : null;
}

/** @returns {object|null} sesión persistida por auth-js si trae refresh_token, o null. */
function readPersistedSession() {
  const key = getAuthStorageKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.refresh_token ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function cacheProfileSnapshot() {
  try {
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ profile: state.profile, flags: state.flags })
    );
  } catch (_e) {
    /* Safari private mode u otro storage lleno/bloqueado: no es crítico. */
  }
}

function readCachedProfileSnapshot() {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

function clearProfileCache() {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch (_e) {
    /* ignore */
  }
}

/** Reintenta el refresh en background mientras dure pendingSession (T1). */
async function attemptRefresh() {
  if (!state.pendingSession) return;
  try {
    // auth-js lee el refresh token de storage solo; si tiene éxito emite
    // TOKEN_REFRESHED via onAuthStateChange, que limpia pendingSession ahí.
    await supabase.auth.refreshSession();
  } catch (e) {
    console.warn('refreshSession retry failed', e);
  }
  scheduleRetry();
}

function scheduleRetry() {
  if (!state.pendingSession) return;
  const delay = RETRY_DELAYS_MS[Math.min(retryStep, RETRY_DELAYS_MS.length - 1)];
  retryStep += 1;
  retryTimeoutId = setTimeout(attemptRefresh, delay);
}

function onOnlineRetry() {
  if (!state.pendingSession) return;
  // La conexión volvió: reintentar ya en vez de esperar el backoff en curso.
  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  attemptRefresh();
}

function startPendingRetry() {
  globalThis.addEventListener('online', onOnlineRetry);
  scheduleRetry();
}

function stopPendingRetry() {
  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  retryStep = 0;
  globalThis.removeEventListener('online', onOnlineRetry);
}

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
  // pendingSession: boot offline con refresh token persistido pero sin
  // access_token todavía. La app es offline-first y ya tiene profile/flags
  // cacheados, así que el guard deja pasar en vez de patear a /login.
  return !!state.session || state.pendingSession;
}

export function isAdmin() {
  return !!state.profile?.isAdmin;
}

export function needsOnboarding() {
  return !!state.session && !!state.profile && !state.profile.username;
}

/**
 * Fetch /api/auth/me and cache the profile.
 * @returns {Promise<boolean>} false si el fetch falló (sesión sin perfil ≠ error).
 */
export async function refreshProfile() {
  if (!state.session) {
    state.profile = null;
    state.flags = [];
    return true;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${state.session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      state.profile = data.profile;
      state.flags = Array.isArray(data.flags) ? data.flags : [];
      cacheProfileSnapshot();
      return true;
    }
    state.profile = null;
    state.flags = [];
    return false;
  } catch (e) {
    console.warn('refreshProfile failed', e);
    state.profile = null;
    state.flags = [];
    return false;
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
  if (state.session) {
    await refreshProfile();
  } else {
    // getSession() dio null, pero puede ser un falso negativo transitorio:
    // auth-js NO borra la sesión persistida en errores de red, solo la borra
    // (y emite SIGNED_OUT) en errores definitivos. Si hay un refresh token
    // guardado, entramos en modo optimista (T1) en vez de mandar al login.
    const persisted = readPersistedSession();
    if (persisted) {
      state.pendingSession = true;
      const cached = readCachedProfileSnapshot();
      if (cached) {
        state.profile = cached.profile ?? null;
        state.flags = Array.isArray(cached.flags) ? cached.flags : [];
      }
      startPendingRetry();
    }
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    state.session = session;
    if (session) {
      if (state.pendingSession) {
        state.pendingSession = false;
        stopPendingRetry();
      }
      signOutRecheckAttempted = false;
      await refreshProfile();
      notify();
      return;
    }

    if (event === 'SIGNED_OUT' && !signOutRecheckAttempted && navigator.onLine) {
      // Multi-pestaña/PWA comparten localStorage: un refresh simultáneo puede
      // producir "Invalid Refresh Token: Already Used" y un SIGNED_OUT global
      // en esta pestaña aunque otra ya haya guardado la sesión rotada nueva.
      // Un solo recheck (con margen corto) antes de patear a /login evita ese
      // falso kick; si vuelve a fallar no se reintenta más en este episodio.
      signOutRecheckAttempted = true;
      const recovered = await recheckSessionAfterSignOut();
      if (recovered) {
        notify();
        return;
      }
    }

    state.profile = null;
    state.flags = [];
    state.pendingSession = false;
    stopPendingRetry();
    clearProfileCache();
    notify();
    if (event === 'SIGNED_OUT') {
      // El router solo reacciona a hashchange y no "ve" los cambios de auth:
      // cualquier cierre de sesión (multi-pestaña, expiración, signOut tardío)
      // debe re-evaluar el guard de la ruta visible. refresh() fuerza el
      // re-resolve y el guard patea a /login con replace si la ruta era protegida.
      // Si ya estamos en /login (p. ej. el logout same-tab ya navegó) no hay
      // nada que re-evaluar y re-resolver duplicaría el render del login.
      const path = getCurrentPath().split('?')[0];
      if (path !== '/login') refresh();
      // idb persiste entre usuarios en el mismo dispositivo: invalidar la cache
      // por-usuario para que el siguiente login no vea datos del anterior.
      // profile:<username> se invalida por PREFIJO (no solo profile:me): cada
      // entrada contiene isOwn/friendStatus calculados PARA el viewer saliente.
      const { invalidatePrefix } = await import('./prefetch.js');
      const { invalidateFriends } = await import('./profileCache.js');
      const { invalidateWeeklyWords } = await import('./weeklyWords.js');
      const { clearSearchUsersCache } = await import('./searchUsersCache.js');
      invalidatePrefix('profile:');
      invalidateFriends();
      invalidateWeeklyWords();
      clearSearchUsersCache();
    }
  });
}

/**
 * Recheck tras SIGNED_OUT (T2): espera un margen corto y relee la sesión por
 * si otra pestaña ya dejó en storage la sesión rotada nueva. Devuelve true y
 * deja el estado consistente (session + profile) si la recuperó.
 */
async function recheckSessionAfterSignOut() {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      state.session = data.session;
      await refreshProfile();
      return true;
    }
  } catch (e) {
    console.warn('recheck tras SIGNED_OUT failed', e);
  }
  return false;
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
  // El handler de SIGNED_OUT también limpia el caché, pero lo hacemos aquí
  // explícito y síncrono con la intención de logout (no depender del timing
  // del evento asíncrono de auth-js).
  clearProfileCache();
  return supabase.auth.signOut();
}
