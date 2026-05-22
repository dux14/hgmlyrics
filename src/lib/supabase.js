/**
 * supabase.js — singleton browser client for Supabase Auth + Storage + DB.
 *
 * Storage strategy: a hybrid adapter so the project rule "no localStorage for
 * tokens" still holds for the long-lived session, while the short-lived PKCE
 * flow state survives the cross-origin OAuth redirect. iOS Safari (especially
 * Private mode) wipes sessionStorage on cross-origin navigation, which would
 * otherwise leave the code_verifier missing or stale when we land back on the
 * callback URL — producing the bad_code_verifier error supabase reports.
 *
 * - `*-code-verifier` and any other PKCE flow keys → localStorage (seconds-long lifetime, removed by supabase-js after exchange).
 * - everything else (including the session token) → sessionStorage.
 */
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');
}

function isPKCEStateKey(key) {
  return key.endsWith('-code-verifier') || key.endsWith('-flow-state');
}

const hybridStorage = {
  getItem(key) {
    const store = isPKCEStateKey(key) ? globalThis.localStorage : globalThis.sessionStorage;
    return store.getItem(key);
  },
  setItem(key, value) {
    const store = isPKCEStateKey(key) ? globalThis.localStorage : globalThis.sessionStorage;
    store.setItem(key, value);
  },
  removeItem(key) {
    const store = isPKCEStateKey(key) ? globalThis.localStorage : globalThis.sessionStorage;
    store.removeItem(key);
  },
};

// detectSessionInUrl: false on purpose. With PKCE the auto-detector starts an
// async exchange at client construction; authStore.initAuthStore() also runs
// a manual exchangeCodeForSession at boot. Both consume the same one-time
// PKCE verifier, so whichever loses the race throws bad_code_verifier. The
// manual path stays as the single source of truth.
export const supabase = createClient(URL, KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    storage: hybridStorage,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
