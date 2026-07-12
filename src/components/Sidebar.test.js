import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn((name) => `<svg data-icon="${name}"></svg>`) }));
vi.mock('../lib/store.js', () => ({
  getAlbums: vi.fn(() => []),
  filterByAlbum: vi.fn(),
  getState: vi.fn(() => ({ activeAlbum: null })),
}));
vi.mock('../lib/lists.js', () => ({ listMyLists: vi.fn(async () => []) }));
vi.mock('../lib/cacheClear.js', () => ({ clearAppCache: vi.fn() }));

import { renderSidebar } from './Sidebar.js';
import { navigate } from '../router.js';

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
});

describe('renderSidebar', () => {
  it('renderiza los items Herramientas y Favoritos', () => {
    const app = document.querySelector('#app');
    renderSidebar(app);
    expect(app.querySelector('[data-nav="herramientas"]')).not.toBeNull();
    expect(app.querySelector('[data-nav="favoritos"]')).not.toBeNull();
  });

  it('click en Herramientas navega a /herramientas', () => {
    const app = document.querySelector('#app');
    renderSidebar(app);
    app.querySelector('[data-nav="herramientas"]').click();
    expect(navigate).toHaveBeenCalledWith('/herramientas');
  });

  it('click en Favoritos navega a /favoritos', () => {
    const app = document.querySelector('#app');
    renderSidebar(app);
    app.querySelector('[data-nav="favoritos"]').click();
    expect(navigate).toHaveBeenCalledWith('/favoritos');
  });

  it('sigue existiendo el item de oracion (no regresion)', () => {
    const app = document.querySelector('#app');
    renderSidebar(app);
    expect(app.querySelector('[data-nav="oracion"]')).not.toBeNull();
  });

  it('renderiza la accion Limpiar cache', () => {
    const app = document.querySelector('#app');
    renderSidebar(app);
    expect(app.querySelector('[data-action="clear-cache"]')).not.toBeNull();
  });

  it('click en Limpiar cache ejecuta clearAppCache', async () => {
    const { clearAppCache } = await import('../lib/cacheClear.js');
    const app = document.querySelector('#app');
    renderSidebar(app);
    app.querySelector('[data-action="clear-cache"]').click();
    await vi.waitFor(() => {
      expect(clearAppCache).toHaveBeenCalled();
    });
  });
});
