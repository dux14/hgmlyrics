/**
 * authCallback.test.js — isSafeRedirect helper (SEC-17: open-redirect)
 */
import { describe, it, expect, vi } from 'vitest';

// Stub out heavy dependencies so the module loads in jsdom without supabase/router.
vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(),
  needsOnboarding: vi.fn(),
}));
vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));
vi.mock('../src/lib/icons.js', () => ({
  icon: vi.fn(() => ''),
}));

// isSafeRedirect is a pure helper; import directly without mounting the component.
const { isSafeRedirect } = await import('../src/components/AuthCallback.js');

describe('isSafeRedirect (SEC-17: open-redirect)', () => {
  it('acepta rutas internas válidas', () => {
    expect(isSafeRedirect('/canciones')).toBe(true);
    expect(isSafeRedirect('/')).toBe(true);
    expect(isSafeRedirect('/perfil/123')).toBe(true);
  });

  it('rechaza //evil.com (open-redirect doble barra)', () => {
    expect(isSafeRedirect('//evil.com')).toBe(false);
    expect(isSafeRedirect('//evil.com/ruta')).toBe(false);
  });

  it('rechaza /\\evil (backslash open-redirect)', () => {
    expect(isSafeRedirect('/\\evil')).toBe(false);
    expect(isSafeRedirect('/\\\\evil.com')).toBe(false);
  });

  it('rechaza URLs absolutas sin slash inicial', () => {
    expect(isSafeRedirect('https://evil.com')).toBe(false);
    expect(isSafeRedirect('http://evil.com')).toBe(false);
  });

  it('rechaza null y valores no-string', () => {
    expect(isSafeRedirect(null)).toBe(false);
    expect(isSafeRedirect(undefined)).toBe(false);
    expect(isSafeRedirect('')).toBe(false);
  });
});
