/**
 * supabase-storage.test.js — La sesión de Supabase Auth debe persistir en
 * localStorage (NO sessionStorage) para que la PWA sobreviva cierres de
 * pestaña/standalone. Si alguien revierte el adapter, este test rompe.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

describe('supabase client storage', () => {
  let supabase;

  beforeAll(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    ({ supabase } = await import('../src/lib/supabase.js'));
  });

  it('uses localStorage as session storage (PWA offline-first)', () => {
    expect(supabase.auth.storage).toBe(globalThis.localStorage);
    expect(supabase.auth.storage).not.toBe(globalThis.sessionStorage);
  });
});
