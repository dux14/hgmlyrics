import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./ThemeToggle.js', () => ({ renderThemeToggle: vi.fn() }));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn((name) => `<svg data-icon="${name}"></svg>`) }));
vi.mock('../lib/authStore.js', () => ({
  getProfile: vi.fn(() => ({ displayName: 'Ada', avatarUrl: null })),
  subscribe: vi.fn(),
}));

import { renderHeader } from './Header.js';
import { navigate } from '../router.js';

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
});

describe('renderHeader', () => {
  it('el logo es el PRIMER hijo del header (izquierda)', () => {
    const app = document.querySelector('#app');
    renderHeader(app);
    const header = app.querySelector('.header');
    expect(header.firstElementChild.classList.contains('header__logo')).toBe(true);
  });

  it('ya NO existe el botón de menú grid en el header', () => {
    const app = document.querySelector('#app');
    renderHeader(app);
    expect(app.querySelector('#menu-btn')).toBeNull();
    expect(app.querySelector('.header__btn--menu')).toBeNull();
  });

  it('renderiza el avatar como enlace al perfil', () => {
    const app = document.querySelector('#app');
    renderHeader(app);
    const avatar = app.querySelector('#header-avatar');
    expect(avatar).not.toBeNull();
    expect(avatar.getAttribute('href')).toBe('#/perfil');
    expect(avatar.querySelector('.header__avatar-img')).not.toBeNull();
  });

  it('click en el avatar navega a /perfil', () => {
    const app = document.querySelector('#app');
    renderHeader(app);
    app.querySelector('#header-avatar').click();
    expect(navigate).toHaveBeenCalledWith('/perfil');
  });

  it('renderiza el botón de oración', () => {
    const app = document.querySelector('#app');
    renderHeader(app);
    const prayer = app.querySelector('#prayer-btn');
    expect(prayer).not.toBeNull();
    expect(prayer.innerHTML).toContain('data-icon="flame"');
  });

  it('NO existe .header__search-trigger ni #cache-btn', () => {
    const app = document.querySelector('#app');
    renderHeader(app);
    expect(app.querySelector('.header__search-trigger')).toBeNull();
    expect(app.querySelector('#cache-btn')).toBeNull();
  });
});
