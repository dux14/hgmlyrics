/**
 * supabase.js — singleton browser client for Supabase Auth + Storage + DB.
 *
 * Storage: localStorage. This is a PWA designed to work offline-first; the
 * session must survive PWA/tab close so users don't re-login on every visit.
 * XSS risk is mitigated by Supabase RLS + anon key model (the access_token
 * only ever has the logged-in user's privileges, never elevates the page).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');
}

/**
 * Key de localStorage donde auth-js persiste la sesión. Replica el mismo
 * algoritmo que supabase-js usa por defecto (ver su SupabaseClient.ts:
 * `sb-${hostname.split('.')[0]}-auth-token`) y se la pasamos explícita a
 * storageKey para que deje de ser una convención implícita: authStore.js la
 * importa de aquí para leer/parsear la sesión persistida en boot (T1) sin
 * re-derivarla por su cuenta.
 */
export const AUTH_STORAGE_KEY = (() => {
  if (!SUPABASE_URL) return null;
  try {
    return `sb-${new globalThis.URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  } catch (_e) {
    return null;
  }
})();

// detectSessionInUrl: false on purpose. With PKCE the auto-detector starts an
// async exchange at client construction; authStore.initAuthStore() also runs
// a manual exchangeCodeForSession at boot. Both consume the same one-time
// PKCE verifier, so whichever loses the race throws bad_code_verifier. The
// manual path stays as the single source of truth.
export const supabase = createClient(SUPABASE_URL, KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    storage: globalThis.localStorage,
    storageKey: AUTH_STORAGE_KEY ?? undefined,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
