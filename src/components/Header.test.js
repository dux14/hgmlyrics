import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./ThemeToggle.js', () => ({ renderThemeToggle: vi.fn() }));
vi.mock('./AuthButton.js', () => ({ renderAuthButton: vi.fn() }));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn((name) => `<svg data-icon="${name}"></svg>`) }));

import { renderHeader } from './Header.js';

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
});

describe('renderHeader', () => {
  it('renderiza #menu-btn con el icono grid', () => {
    const app = document.querySelector('#app');
    renderHeader(app, { onMenuToggle: vi.fn() });
    const menuBtn = app.querySelector('#menu-btn');
    expect(menuBtn).not.toBeNull();
    expect(menuBtn.innerHTML).toContain('data-icon="grid"');
  });

  it('NO existe .header__search-trigger', () => {
    const app = document.querySelector('#app');
    renderHeader(app, { onMenuToggle: vi.fn() });
    expect(app.querySelector('.header__search-trigger')).toBeNull();
  });

  it('NO existe #cache-btn', () => {
    const app = document.querySelector('#app');
    renderHeader(app, { onMenuToggle: vi.fn() });
    expect(app.querySelector('#cache-btn')).toBeNull();
  });

  it('el logo es el último hijo del header', () => {
    const app = document.querySelector('#app');
    renderHeader(app, { onMenuToggle: vi.fn() });
    const header = app.querySelector('.header');
    const lastChild = header.lastElementChild;
    expect(lastChild.classList.contains('header__logo')).toBe(true);
  });

  it('onMenuToggle se llama al hacer click en #menu-btn', () => {
    const app = document.querySelector('#app');
    const onMenuToggle = vi.fn();
    renderHeader(app, { onMenuToggle });
    app.querySelector('#menu-btn').click();
    expect(onMenuToggle).toHaveBeenCalledTimes(1);
  });

  it('aria-label del botón menú es "Abrir navegación"', () => {
    const app = document.querySelector('#app');
    renderHeader(app, { onMenuToggle: vi.fn() });
    expect(app.querySelector('#menu-btn').getAttribute('aria-label')).toBe('Abrir navegación');
  });
});
