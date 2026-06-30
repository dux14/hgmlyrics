import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./ThemeToggle.js', () => ({ renderThemeToggle: vi.fn() }));
vi.mock('./AuthButton.js', () => ({ renderAuthButton: vi.fn() }));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('./SearchFocus.js', () => ({ openSearchFocus: vi.fn() }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn().mockReturnValue('') }));

import { renderHeader } from './Header.js';
import { openSearchFocus } from './SearchFocus.js';

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
});

describe('renderHeader — búsqueda como disparador', () => {
  it('renderiza un botón-pill de búsqueda, no un input inline', () => {
    const app = document.querySelector('#app');
    renderHeader(app, { onMenuToggle: vi.fn() });
    expect(app.querySelector('#search-input')).toBeNull();
    expect(app.querySelector('#search-results')).toBeNull();
    expect(app.querySelector('.header__search-trigger')).not.toBeNull();
  });

  it('al activar el pill abre el focus de búsqueda', async () => {
    const app = document.querySelector('#app');
    renderHeader(app, { onMenuToggle: vi.fn() });
    app.querySelector('.header__search-trigger').click();
    // La importación dinámica resuelve después de que el módulo es cargado/cacheado
    await new Promise((r) => setTimeout(r, 0));
    expect(openSearchFocus).toHaveBeenCalledTimes(1);
  });
});
