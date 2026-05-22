/**
 * supabase.js — singleton browser client for Supabase Auth + Storage + DB.
 *
 * Configured for PKCE OAuth flow and sessionStorage persistence
 * (matches the project rule "no localStorage for tokens").
 */
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');
}

// detectSessionInUrl: false on purpose. With PKCE the auto-detector starts an
// async exchange at client construction; authStore.initAuthStore() also runs a
// manual exchangeCodeForSession at boot. Both consume the same one-time PKCE
// verifier, so whichever loses the race throws bad_code_verifier. The manual
// path stays as the single source of truth.
export const supabase = createClient(URL, KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    storage: globalThis.sessionStorage,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
