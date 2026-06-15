/**
 * SEC-X1: Tests de escape XSS para PublicProfile (avatarUrl en img src)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok' })),
}));

import { renderPublicProfile } from './PublicProfile.js';

describe('renderPublicProfile — SEC-X1: avatarUrl escapado en img src', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('avatarUrl con payload XSS no crea atributo onerror ejecutable', async () => {
    const maliciousAvatar = '" onerror="alert(1)" x="';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            profile: {
              avatarUrl: maliciousAvatar,
              displayName: 'Ana',
              username: 'ana',
              bio: null,
              voiceType: null,
              voiceSubtype: null,
              vocalRangeLow: null,
              vocalRangeHigh: null,
              vocalRangeNotes: null,
              instrumentRoles: [],
            },
            favorites: [],
            friendCount: 0,
            isOwn: false,
          }),
      }),
    );

    const container = document.createElement('div');
    await renderPublicProfile(container, 'ana');

    // No debe existir <img> con atributo onerror ejecutable
    expect(container.querySelector('img[onerror]')).toBeNull();

    const img = container.querySelector('img.profile-avatar');
    expect(img).not.toBeNull();
    expect(img.hasAttribute('onerror')).toBe(false);
  });

  it('avatarUrl legítima (https) se muestra como src sin modificaciones', async () => {
    const legitUrl = 'https://example.supabase.co/storage/v1/object/public/avatars/ana.webp';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            profile: {
              avatarUrl: legitUrl,
              displayName: 'Ana',
              username: 'ana',
              bio: null,
              voiceType: null,
              voiceSubtype: null,
              vocalRangeLow: null,
              vocalRangeHigh: null,
              vocalRangeNotes: null,
              instrumentRoles: [],
            },
            favorites: [],
            friendCount: 0,
            isOwn: false,
          }),
      }),
    );

    const container = document.createElement('div');
    await renderPublicProfile(container, 'ana');

    const img = container.querySelector('img.profile-avatar');
    expect(img).not.toBeNull();
    // escapeHtml no altera una URL legítima que no contiene &<>"'
    expect(img.getAttribute('src')).toBe(legitUrl);
  });
});
