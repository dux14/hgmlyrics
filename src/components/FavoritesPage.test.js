import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/store.js', () => ({
  getState: vi.fn(() => ({ songs: [] })),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('../lib/favorites.js', () => ({
  subscribe: vi.fn(() => () => {}),
  isFavorite: vi.fn(() => false),
  toggleFavorite: vi.fn(),
}));
vi.mock('../router.js', () => ({ navigate: vi.fn(), getCurrentPath: vi.fn(() => '/favoritos') }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));
vi.mock('./songRow.js', () => ({ resolveCoverUrl: vi.fn((s) => `/covers/${s.coverImage || ''}`) }));

import { renderFavoritesPage } from './FavoritesPage.js';
import { getState } from '../lib/store.js';
import { isFavorite } from '../lib/favorites.js';

it('no renderiza botón Volver ni toggle de vista', async () => {
  const container = document.createElement('div');
  renderFavoritesPage(container);
  await Promise.resolve();
  expect(container.querySelector('#back-btn')).toBeNull();
  expect(container.querySelector('.fav-toggle')).toBeNull();
});

it('muestra título discreto y contador', async () => {
  const container = document.createElement('div');
  renderFavoritesPage(container);
  await Promise.resolve();
  expect(container.querySelector('.fav-page__title')?.textContent).toContain('Favoritos');
});

describe('SEC-14: FavoritesPage escapa title con payload XSS', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('no crea elementos script ni atributos onerror en el grid de favoritos', () => {
    const payload = '<script>alert(1)</script>';
    const song = { id: '1', title: payload, coverImage: '' };
    getState.mockReturnValue({ songs: [song] });
    isFavorite.mockReturnValue(true);

    const container = document.createElement('div');
    renderFavoritesPage(container);

    // No debe haber <script> en el DOM
    expect(container.querySelector('script')).toBeNull();
    // El titulo escapado debe aparecer como texto, no como HTML ejecutable
    const titleSpan = container.querySelector('.fav-cover__title');
    expect(titleSpan).toBeTruthy();
    expect(titleSpan.textContent).toContain('<script>');
    // El aria-label en el HTML crudo debe contener la entidad escapada
    const link = container.querySelector('.fav-cover');
    expect(link.outerHTML).toContain('&lt;');
  });

  it('escapa comillas en title dentro de aria-label', () => {
    const payload = '"><img onerror=alert(1)>';
    const song = { id: '2', title: payload, coverImage: '' };
    getState.mockReturnValue({ songs: [song] });
    isFavorite.mockReturnValue(true);

    const container = document.createElement('div');
    renderFavoritesPage(container);

    // El HTML crudo del link no debe contener comilla suelta que rompa el atributo
    // (las comillas deben estar escapadas como &quot;)
    const link = container.querySelector('.fav-cover');
    expect(link.outerHTML).toContain('&quot;');
    // No debe haber img con onerror creado como elemento
    expect(container.querySelector('img[onerror]')).toBeNull();
  });
});
