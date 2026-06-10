/**
 * worldPage.test.js — tests para la función pura resolveWorldGate.
 * Phaser NO corre en jsdom; por eso sólo se testea la lógica pura aquí.
 *
 * WorldPage.js importa authStore que a su vez inicializa supabase, por lo que
 * hay que mockear supabase para que el módulo cargue en jsdom sin credenciales.
 */
import { vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

import { resolveWorldGate } from '../../src/components/WorldPage.js';

describe('resolveWorldGate', () => {
  it('devuelve "login" cuando user es null', () => {
    expect(resolveWorldGate({ user: null, online: true })).toBe('login');
  });

  it('devuelve "login" cuando user es undefined', () => {
    expect(resolveWorldGate({ user: undefined, online: true })).toBe('login');
  });

  it('devuelve "offline" cuando hay user pero no hay conexión', () => {
    expect(resolveWorldGate({ user: { id: 'u1' }, online: false })).toBe('offline');
  });

  it('devuelve "ok" cuando hay user y hay conexión', () => {
    expect(resolveWorldGate({ user: { id: 'u1' }, online: true })).toBe('ok');
  });
});
