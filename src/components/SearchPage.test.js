/**
 * SearchPage.test.js — smoke tests para el browse hub.
 * Cubre: catálogo tile-grid, sección favoritos (oculta sin auth), rail de álbumes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../router.js', () => ({ navigate: vi.fn() }));

vi.mock('../lib/store.js', () => ({
  getState: vi.fn(),
  getAlbums: vi.fn(),
}));

vi.mock('./songRow.js', () => ({
  resolveCoverUrl: vi.fn((s) => s.coverImage || ''),
}));

vi.mock('../lib/authStore.js', () => ({
  isAuthenticated: vi.fn(),
}));

vi.mock('../lib/favorites.js', () => ({
  isFavorite: vi.fn(),
}));

vi.mock('../lib/icons.js', () => ({
  icon: vi.fn(() => '<svg></svg>'),
  COVER_PLACEHOLDER: 'placeholder.svg',
}));

vi.mock('../lib/escape.js', () => ({
  escapeHtml: vi.fn((s) => (s === null || s === undefined ? '' : String(s))),
}));

vi.mock('./songTile.js', () => ({
  songTile: vi.fn((song) => {
    const div = document.createElement('div');
    div.className = 'song-tile';
    div.setAttribute('aria-label', `${song.title} — ${song.album}`);
    return div;
  }),
}));

import { getState, getAlbums } from '../lib/store.js';
import { isAuthenticated } from '../lib/authStore.js';
import { isFavorite } from '../lib/favorites.js';
import { icon } from '../lib/icons.js';
import { renderSearchPage } from './SearchPage.js';

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  getState.mockReturnValue({ songs: [], filtered: [] });
  getAlbums.mockReturnValue([]);
  isAuthenticated.mockReturnValue(false);
  isFavorite.mockReturnValue(false);
});

describe('renderSearchPage', () => {
  it('catálogo: N canciones en el store → grid contiene N hijos', async () => {
    const songs = [
      { id: '1', title: 'Una', album: 'Album A', coverImage: '' },
      { id: '2', title: 'Dos', album: 'Album A', coverImage: '' },
      { id: '3', title: 'Tres', album: 'Album B', coverImage: '' },
    ];
    getState.mockReturnValue({ songs, filtered: songs });

    const container = document.createElement('div');
    await renderSearchPage(container);

    const grid = container.querySelector('.song-tile-grid');
    expect(grid).not.toBeNull();
    expect(grid.children).toHaveLength(3);
  });

  it('no muestra "Tus favoritos" cuando isAuthenticated() es false', async () => {
    getState.mockReturnValue({
      songs: [{ id: '1', title: 'Una', album: 'Alb', coverImage: '' }],
      filtered: [],
    });
    isAuthenticated.mockReturnValue(false);

    const container = document.createElement('div');
    await renderSearchPage(container);

    const headings = Array.from(container.querySelectorAll('.search-section__head h2')).map(
      (h) => h.textContent,
    );
    expect(headings).not.toContain('Tus favoritos');
  });

  it('álbumes: getAlbums() con datos → .search-rail con .search-rail__album cards', async () => {
    const albums = [
      { slug: 'album-uno', name: 'Album Uno', coverImage: '' },
      { slug: 'album-dos', name: 'Album Dos', coverImage: '' },
    ];
    getState.mockReturnValue({ songs: [], filtered: [] });
    getAlbums.mockReturnValue(albums);

    const container = document.createElement('div');
    await renderSearchPage(container);

    const rail = container.querySelector('.search-rail');
    expect(rail).not.toBeNull();
    const cards = rail.querySelectorAll('.search-rail__album');
    expect(cards).toHaveLength(2);
  });

  it('renderiza Álbumes antes de Todas las canciones', async () => {
    const albums = [{ slug: 'album-uno', name: 'Album Uno', coverImage: '' }];
    getState.mockReturnValue({
      songs: [{ id: '1', title: 'Una', album: 'Album Uno', coverImage: '' }],
      filtered: [],
    });
    getAlbums.mockReturnValue(albums);

    const container = document.createElement('div');
    await renderSearchPage(container);

    const heads = [...container.querySelectorAll('.search-section__head h2')].map(
      (h) => h.textContent,
    );
    const iAlb = heads.findIndex((t) => /Álbumes/i.test(t));
    const iAll = heads.findIndex((t) => /Todas las canciones/i.test(t));
    expect(iAlb).toBeGreaterThanOrEqual(0);
    expect(iAlb).toBeLessThan(iAll);
  });

  it('la voz en off usa icono gospel, no mic', async () => {
    getState.mockReturnValue({ songs: [], filtered: [] });
    const weeklyWords = [{ id: 'ww1', title: 'Palabra del dia', gospel_ref: 'Juan 1:1' }];

    const container = document.createElement('div');
    await renderSearchPage(container, weeklyWords);

    const iconCalls = icon.mock.calls.map((c) => c[0]);
    expect(iconCalls).toContain('gospel');
    expect(iconCalls).not.toContain('mic');
  });
});
