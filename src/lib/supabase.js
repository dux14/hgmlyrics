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

export const supabase = createClient(URL, KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    storage: globalThis.sessionStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
