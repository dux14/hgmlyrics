import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ user: { id: 'me' }, access_token: 't' })),
}));
vi.mock('../lib/friends.js', () => ({ emitPendingChanged: vi.fn() }));

import { buildTabs, buildFriendItem } from './FriendsPanel.js';

describe('buildTabs', () => {
  it('pinta el contador en Recibidas y roles ARIA', () => {
    const el = document.createElement('div');
    el.innerHTML = buildTabs('accepted', 3);
    const inc = el.querySelector('[data-tab="incoming"]');
    expect(inc.getAttribute('role')).toBe('tab');
    expect(inc.querySelector('.seg-tab__count').textContent).toBe('3');
  });
  it('marca aria-selected en la tab activa', () => {
    const el = document.createElement('div');
    el.innerHTML = buildTabs('incoming', 0);
    expect(el.querySelector('[data-tab="incoming"]').getAttribute('aria-selected')).toBe('true');
  });
  it('oculta el contador cuando es 0', () => {
    const el = document.createElement('div');
    el.innerHTML = buildTabs('accepted', 0);
    expect(el.querySelector('[data-tab="incoming"] .seg-tab__count')).toBeFalsy();
  });
});

describe('buildFriendItem', () => {
  const item = {
    requesterId: 'other',
    requesterUsername: 'leo',
    requesterDisplayName: 'Leo',
    requesterAvatarUrl: '',
  };
  it('Aceptar usa la píldora primary en incoming', () => {
    const el = document.createElement('div');
    el.innerHTML = buildFriendItem(item, 'me', 'incoming');
    const accept = el.querySelector('[data-act="accept"]');
    expect(accept.classList.contains('pill--primary')).toBe(true);
  });
  it('avatar a color cuando no hay imagen', () => {
    const el = document.createElement('div');
    el.innerHTML = buildFriendItem(item, 'me', 'accepted');
    expect(el.querySelector('.friend-card__avatar')).toBeTruthy();
  });

  it('SEC-01: avatarUrl XSS payload no produce atributo onerror en el DOM', () => {
    const maliciousItem = {
      requesterId: 'attacker',
      requesterUsername: 'attacker',
      requesterDisplayName: 'Attacker',
      requesterAvatarUrl: '" onerror="alert(1)" x="',
    };
    const el = document.createElement('div');
    el.innerHTML = buildFriendItem(maliciousItem, 'me', 'incoming');
    const img = el.querySelector('img.friend-card__avatar');
    // The img must exist (avatar was non-empty) and must NOT have an onerror attribute
    expect(img).toBeTruthy();
    expect(img.getAttribute('onerror')).toBeNull();
    // The src attribute value must contain the literal payload text (escaped), not execute it
    // i.e. the double-quote in the payload must have been escaped to &quot; so the attribute
    // boundary was never broken — confirmed by the absence of the onerror DOM attribute above.
  });
});
