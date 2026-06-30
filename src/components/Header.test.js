import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./ThemeToggle.js', () => ({ renderThemeToggle: vi.fn() }));
vi.mock('./AuthButton.js', () => ({ renderAuthButton: vi.fn() }));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('./CommandPalette.js', () => ({ openCommandPalette: vi.fn() }));
// Mocks extra para que el Header.js pre-fix no falle por imports sin resolver
vi.mock('../lib/search.js', () => ({ searchAll: vi.fn().mockReturnValue([]) }));
vi.mock('../lib/escape.js', () => ({ escapeHtml: vi.fn((s) => s) }));
vi.mock('../lib/searchRow.js', () => ({ weeklyWordSearchRow: vi.fn().mockReturnValue('') }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn().mockReturnValue('') }));

import { renderHeader } from './Header.js';
import { openCommandPalette } from './CommandPalette.js';

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

  it('al activar el pill abre el command palette', () => {
    const app = document.querySelector('#app');
    renderHeader(app, { onMenuToggle: vi.fn() });
    app.querySelector('.header__search-trigger').click();
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });
});
