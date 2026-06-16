import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  getProfile: vi.fn(() => ({ displayName: 'Ana', username: 'ana', avatarUrl: '' })),
  signOut: vi.fn(),
  subscribe: vi.fn(),
  isAdmin: vi.fn(() => false),
}));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));

import { buildMenu, buildButton } from './AuthButton.js';
import { isAdmin } from '../lib/authStore.js';

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

  it('muestra el enlace Admin cuando isAdmin() es true', () => {
    vi.mocked(isAdmin).mockReturnValueOnce(true);
    const el = document.createElement('div');
    el.innerHTML = buildMenu('/perfil', 0);
    expect(el.querySelector('a[href="#/admin"]')).toBeTruthy();
  });

  it('omite el enlace Admin cuando isAdmin() es false', () => {
    vi.mocked(isAdmin).mockReturnValueOnce(false);
    const el = document.createElement('div');
    el.innerHTML = buildMenu('/perfil', 0);
    expect(el.querySelector('a[href="#/admin"]')).toBeNull();
  });
});

describe('buildButton', () => {
  it('pinta punto en el avatar cuando hay pendientes', () => {
    const el = document.createElement('div');
    el.innerHTML = buildButton({ displayName: 'Ana', username: 'ana', avatarUrl: '' }, 1);
    expect(el.querySelector('.auth-button__dot')).toBeTruthy();
  });

  it('SEC-04: escapa displayName con payload XSS', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const el = document.createElement('div');
    el.innerHTML = buildButton({ displayName: payload, username: 'u', avatarUrl: '' }, 0);
    // El <img> malicioso no debe aparecer como elemento img dentro del span
    const span = el.querySelector('.auth-button span');
    expect(span.querySelector('img')).toBeNull();
    expect(span.textContent).toContain('<img');
  });

  it('SEC-04: escapa avatarUrl con payload XSS', () => {
    const payload = '" onerror="alert(1)';
    const el = document.createElement('div');
    el.innerHTML = buildButton({ displayName: 'Ana', username: 'ana', avatarUrl: payload }, 0);
    // Al parsear el HTML, jsdom no debe haber creado un atributo onerror ejecutable en img
    const img = el.querySelector('.auth-button__avatar');
    expect(img.hasAttribute('onerror')).toBe(false);
    // La comilla doble del payload no rompió el atributo src — src contiene el payload sin ejecutar
    expect(img.getAttribute('src')).toContain(' onerror=');
  });
});
