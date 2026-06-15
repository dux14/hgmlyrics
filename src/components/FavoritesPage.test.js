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
vi.mock('./SongList.js', () => ({ renderSongList: vi.fn() }));
vi.mock('../router.js', () => ({ navigate: vi.fn(), getCurrentPath: vi.fn(() => '/favoritos') }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));
vi.mock('./songRow.js', () => ({ resolveCoverUrl: vi.fn((s) => `/covers/${s.coverImage || ''}`) }));

import { getFavView, setFavView, FAV_VIEW_KEY } from './FavoritesPage.js';

describe('preferencia de vista de favoritos', () => {
  beforeEach(() => localStorage.clear());

  it('por defecto es grid', () => {
    expect(getFavView()).toBe('grid');
  });
  it('persiste y relee la preferencia', () => {
    setFavView('list');
    expect(localStorage.getItem(FAV_VIEW_KEY)).toBe('list');
    expect(getFavView()).toBe('list');
  });
  it('ignora valores inválidos y cae a grid', () => {
    localStorage.setItem(FAV_VIEW_KEY, 'banana');
    expect(getFavView()).toBe('grid');
  });
});
