import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  getProfile: vi.fn(() => ({ displayName: 'Ana', username: 'ana', avatarUrl: '' })),
  signOut: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));

import { buildMenu, buildButton } from './AuthButton.js';

describe('buildMenu', () => {
  it('marca el item activo con aria-current', () => {
    const html = buildMenu('/perfil', 0);
    const el = document.createElement('div');
    el.innerHTML = html;
    const active = el.querySelector('[aria-current="page"]');
    expect(active).toBeTruthy();
    expect(active.getAttribute('href')).toBe('#/perfil');
  });

  it('muestra punto de pendientes en Amigos cuando count > 0', () => {
    const el = document.createElement('div');
    el.innerHTML = buildMenu('/perfil', 2);
    const amigos = el.querySelector('a[href="#/amigos"]');
    expect(amigos.querySelector('.auth-menu__dot')).toBeTruthy();
  });

  it('no muestra punto cuando count = 0', () => {
    const el = document.createElement('div');
    el.innerHTML = buildMenu('/perfil', 0);
    const amigos = el.querySelector('a[href="#/amigos"]');
    expect(amigos.querySelector('.auth-menu__dot')).toBeFalsy();
  });
});

describe('buildButton', () => {
  it('pinta punto en el avatar cuando hay pendientes', () => {
    const el = document.createElement('div');
    el.innerHTML = buildButton({ displayName: 'Ana', username: 'ana', avatarUrl: '' }, 1);
    expect(el.querySelector('.auth-button__dot')).toBeTruthy();
  });
});
