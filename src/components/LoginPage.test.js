import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  signInWithGoogle: vi.fn(),
  signInWithMagicLink: vi.fn(),
}));

vi.mock('../lib/icons.js', () => ({
  icon: vi.fn(() => ''),
}));

import { renderLoginPage } from './LoginPage.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="c"></div>';
  vi.stubGlobal('navigator', { onLine: true });
});

describe('renderLoginPage — branding Ambient Kinetic', () => {
  it('incluye el logo HKN y el título de inicio de sesión', () => {
    const c = document.querySelector('#c');
    renderLoginPage(c);
    expect(c.querySelector('.auth-logo')).not.toBeNull();
    expect(c.querySelector('.auth-title').textContent).toContain('Inicia sesión');
  });
});
