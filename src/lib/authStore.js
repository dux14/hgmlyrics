/**
 * authStore.js — central auth state with pub/sub.
 *
 * Mirrors the pattern from store.js: getXxx() snapshots, subscribe(fn),
 * mutations only via exported actions. Wraps supabase.auth.onAuthStateChange.
 */
import { supabase, AUTH_STORAGE_KEY } from './supabase.js';
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
 * fallida en varias pestañas). Se resetea cuando vuelve a haber sesión
 * (incluida la recuperación exitosa dentro de recheckSessionAfterSignOut,
 * que no pasa por el listener normal).
 */
let signOutRecheckAttempted = false;

/**
 * true entre que signOut() llama a supabase.auth.signOut() y el SIGNED_OUT
 * resultante se procesa. Un logout propio no necesita el recheck de T2 (no
 * hay sesión rotada de otra pestaña que esperar) y además NO puede
 * awaitearlo: ver la nota grande en initAuthStore sobre el deadlock de
 * auth-js durante signOut().
 */
let intentionalSignOut = false;

const PROFILE_CACHE_KEY = 'hkn-profile-cache';
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];
let retryTimeoutId = null;
let retryStep = 0;
// Evita que un 'online' dispare un segundo refreshSession() mientras el
// intento programado por backoff ya está en vuelo (issue Minor T3).
let refreshInFlight = false;

/**
 * @returns {object|null} sesión persistida por auth-js si trae refresh_token, o null.
 * Lee AUTH_STORAGE_KEY de supabase.js (misma fuente que storageKey del
 * cliente) en vez de re-derivar la convención `sb-<ref>-auth-token` acá: si
 * alguna vez se pasa un storageKey custom, ambos quedan sincronizados solos.
 */
function readPersistedSession() {
  if (!AUTH_STORAGE_KEY) return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
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
      JSON.stringify({ profile: state.profile, flags: state.flags }),
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
  // El 'online' listener puede disparar un intento mientras el que ya venía
  // por backoff sigue esperando refreshSession(): sin este guard, si ambos
  // fallan, ambos reprograman y queda un timer huérfano sin rastrear.
  if (!state.pendingSession || refreshInFlight) return;
  refreshInFlight = true;
  try {
    // auth-js lee el refresh token de storage solo. Además de emitir
    // TOKEN_REFRESHED via onAuthStateChange (que también limpia pendingSession
    // llamando a esta misma función), resolvemos el éxito aquí mismo: no
    // asumimos el orden/timing en que auth-js dispara ese evento respecto a
    // esta promesa.
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data?.session) {
      await clearPendingSession(data.session);
      return;
    }
  } catch (e) {
    console.warn('refreshSession retry failed', e);
  } finally {
    refreshInFlight = false;
  }
  scheduleRetry();
}

/**
 * Marca pendingSession como resuelto con éxito: setea la sesión, detiene el
 * retry y refresca el perfil. Único punto de salida de pendingSession —
 * tanto attemptRefresh (éxito directo de refreshSession) como la rama
 * "if (session)" de onAuthStateChange (evento TOKEN_REFRESHED de auth-js) la
 * llaman en vez de duplicar la limpieza inline.
 *
 * El guard `if (!state.pendingSession) return` es lo que la hace idempotente:
 * desde auth-js 2.106, con BroadcastChannel multi-pestaña activo por
 * defecto, un TOKEN_REFRESHED puede llegar por un camino async separado del
 * refreshSession() que ya estemos esperando aquí mismo — cualquiera de los
 * dos caminos que llegue primero limpia pendingSession; el segundo entra al
 * guard y no repite el fetch de perfil ni el notify.
 */
async function clearPendingSession(session) {
  if (!state.pendingSession) return;
  state.pendingSession = false;
  stopPendingRetry();
  state.session = session;
  await refreshProfile();
  notify();
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
  const snap = { session: state.session, profile: state.profile, pending: state.pendingSession };
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

/** @returns {boolean} true si estamos en modo pendingSession (T1, boot offline). */
export function isPendingSession() {
  return state.pendingSession;
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
    if (state.pendingSession) {
      // pendingSession (T1): boot offline, todavía sin access_token, no es
      // un logout. No nuleamos el profile restaurado del caché — devolvemos
      // false para que fetchMyProfile() (profileCache.js) lance y cached()
      // caiga a su fallback idb en vez de envenenar profile:me con null.
      return false;
    }
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
    // El server respondió y dijo que no (401/403/500...): sesión sin perfil
    // válido, no queremos dejar UI admin colgada de un caché tras una
    // revocación real. Acá sí nuleamos.
    state.profile = null;
    state.flags = [];
    return false;
  } catch (e) {
    // El fetch LANZÓ (red caída, timeout): el server nunca habló. No es una
    // revocación, es un fallo transitorio — conservamos el último
    // profile/flags en memoria (p. ej. el restaurado del caché en modo
    // pendingSession) en vez de nulearlo encima.
    console.warn('refreshProfile failed', e);
    // Con red caída y sin perfil en memoria (boot en frío con token vigente),
    // restaurar el último snapshot local: mismo fallback que la rama
    // pendingSession, que hasta ahora era el único camino cubierto (H4).
    if (!state.profile) {
      const cached = readCachedProfileSnapshot();
      if (cached) {
        state.profile = cached.profile ?? null;
        state.flags = Array.isArray(cached.flags) ? cached.flags : [];
      }
    }
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

  // ADVERTENCIA — deadlock de auth-js: durante signOut() (o cualquier otra
  // operación de supabase.auth), la librería sostiene un lock interno hasta
  // que TODOS los callbacks de onAuthStateChange resuelven
  // (_notifyAllSubscribers hace `await Promise.all(callbacks)` dentro de la
  // sección bloqueada). Si un callback llama —y espera— a otro método de
  // supabase.auth (getSession, refreshSession...) ANTES de resolver, esa
  // llamada reintenta adquirir el mismo lock y queda esperando a que la
  // operación en curso termine, que a su vez espera a que el callback
  // resuelva: dependencia circular, cuelga para siempre (visto con
  // signOut() real: Profile.js hace `await signOut()`).
  // Regla dura de este callback: NUNCA llamar (ni siquiera sin await, la
  // sola invocación ya intenta el lock) un método de supabase.auth antes de
  // que el callback retorne. Todo lo que necesite volver a hablar con
  // supabase.auth (el recheck de T2) se difiere con setTimeout(0) para
  // correr en un macrotask aparte, después de que este callback ya haya
  // resuelto y el lock se haya liberado.
  supabase.auth.onAuthStateChange(async (event, session) => {
    state.session = session;
    if (session) {
      signOutRecheckAttempted = false;
      if (state.pendingSession) {
        // TOKEN_REFRESHED (u otro evento con sesión) llegó mientras había un
        // reintento en curso: clearPendingSession() es idempotente frente al
        // camino de attemptRefresh, cualquiera de los dos que llegue primero.
        // refreshProfile() adentro solo llama a fetch() propio, no a
        // supabase.auth, así que awaitearla acá es seguro.
        await clearPendingSession(session);
      } else {
        // Sesión normal, sin pendingSession de por medio (login, refresh
        // automático de auth-js sin boot offline, etc).
        await refreshProfile();
        notify();
      }
      return;
    }

    // auth-js SIEMPRE emite INITIAL_SESSION con la sesión actual justo
    // después de registrar el listener (GoTrueClient._emitInitialSession).
    // En boot offline con token expirado esa sesión es null y llega
    // milisegundos después de que initAuthStore ya armó pendingSession — no
    // es una señal de logout, así que no tocamos nada (ni notify) salvo que
    // el evento sea el SIGNED_OUT real y definitivo.
    if (state.pendingSession && event !== 'SIGNED_OUT') {
      return;
    }

    if (
      event === 'SIGNED_OUT' &&
      !intentionalSignOut &&
      !signOutRecheckAttempted &&
      navigator.onLine
    ) {
      // Multi-pestaña/PWA comparten localStorage: un refresh simultáneo puede
      // producir "Invalid Refresh Token: Already Used" y un SIGNED_OUT global
      // en esta pestaña aunque otra ya haya guardado la sesión rotada nueva.
      // Un solo recheck (con margen corto) antes de patear a /login evita ese
      // falso kick; si vuelve a fallar no se reintenta más en este episodio.
      signOutRecheckAttempted = true;
      setTimeout(() => {
        recheckSessionAfterSignOut()
          .then((recovered) => {
            if (recovered) {
              notify();
              return undefined;
            }
            return runSignOutKick(event);
          })
          .catch((e) => {
            console.warn('recheck diferido tras SIGNED_OUT failed', e);
            return runSignOutKick(event);
          });
      }, 0);
      return;
    }

    // SIGNED_OUT propio (signOut() nuestro: sin recheck, directo al kick) o
    // no elegible para recheck (ya se intentó en este episodio, u offline).
    // Ninguno de estos dos casos llama a supabase.auth, así que awaitear
    // runSignOutKick() acá mismo es seguro.
    await runSignOutKick(event);
  });
}

/**
 * Limpieza terminal de sesión: nulea profile/flags, sale de pendingSession y,
 * si el evento es SIGNED_OUT, dispara el kick de ruta (refresh() del router)
 * y la invalidación de caches por-usuario. No llama a supabase.auth en
 * ningún punto — es seguro invocarla tanto síncronamente desde el callback
 * de onAuthStateChange como desde el camino diferido del recheck de T2.
 */
async function runSignOutKick(event) {
  intentionalSignOut = false;
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
}

/**
 * Recheck tras SIGNED_OUT (T2): espera un margen corto y relee la sesión por
 * si otra pestaña ya dejó en storage la sesión rotada nueva. Devuelve true y
 * deja el estado consistente (session + profile) si la recuperó. Solo se
 * llama desde el camino diferido (setTimeout) del callback, nunca
 * síncronamente desde dentro de onAuthStateChange — ver la nota grande de
 * initAuthStore sobre el deadlock de auth-js.
 */
async function recheckSessionAfterSignOut() {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      state.session = data.session;
      // La recuperación no pasa por el listener normal (que resetea el flag
      // cuando hay session): el episodio se resolvió con éxito, uno nuevo
      // debe poder volver a intentar su propio recheck.
      signOutRecheckAttempted = false;
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

/**
 * Verifica el código OTP de 8 dígitos que llega en el mismo correo del
 * magic link (T3). Funciona en cualquier navegador/pestaña porque no
 * depende del code_verifier de PKCE que sí requiere el enlace.
 * @param {string} email
 * @param {string} token
 */
export async function verifyEmailOtp(email, token) {
  return supabase.auth.verifyOtp({ email, token, type: 'email' });
}

export async function signOut() {
  // Marcado ANTES de llamar a supabase.auth.signOut(): el SIGNED_OUT que va
  // a disparar es propio, así que el handler debe saltarse el recheck de T2
  // por completo (no hay sesión rotada de otra pestaña que esperar, y
  // esperarla igual arriesgaría el deadlock de auth-js documentado en
  // initAuthStore) e ir directo al kick, sin el margen de 1.5s.
  intentionalSignOut = true;
  // El handler de SIGNED_OUT también limpia el caché, pero lo hacemos aquí
  // explícito y síncrono con la intención de logout (no depender del timing
  // del evento asíncrono de auth-js).
  clearProfileCache();
  try {
    const result = await supabase.auth.signOut();
    if (result?.error) {
      // supabase.auth.signOut() puede retornar temprano SIN _removeSession
      // (y por lo tanto sin emitir SIGNED_OUT) ante un sessionError que no
      // sea AuthSessionMissingError, o un error de red no ignorado del
      // signOut admin. Si nunca llega el SIGNED_OUT propio, el flag se
      // quedaría pegado en true para siempre y el próximo SIGNED_OUT
      // legítimo (rotación multi-pestaña) saltaría el recheck de T2 sin
      // razón. Lo revertimos acá.
      intentionalSignOut = false;
    }
    return result;
  } catch (e) {
    // Misma razón que arriba: si signOut() lanza, tampoco emitió SIGNED_OUT.
    intentionalSignOut = false;
    throw e;
  }
}
