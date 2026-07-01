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

vi.mock('../lib/search.js', () => ({
  searchEverything: vi.fn(() => ({ songs: [], albums: [], voces: [] })),
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
  sessionStorage.clear();
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

  it('ordena los álbumes por year desc (2026 antes que 2019)', async () => {
    getAlbums.mockReturnValue([
      { slug: 'viejo', name: 'Viejo', coverImage: '', year: 2019 },
      { slug: 'nuevo', name: 'Nuevo', coverImage: '', year: 2026 },
    ]);
    getState.mockReturnValue({ songs: [], filtered: [] });

    const container = document.createElement('div');
    await renderSearchPage(container);

    const names = [...container.querySelectorAll('.search-rail__album span')].map(
      (s) => s.textContent,
    );
    expect(names).toEqual(['Nuevo', 'Viejo']);
  });

  it('renderiza una barra de búsqueda sticky con input[type=search]', async () => {
    getState.mockReturnValue({ songs: [], filtered: [] });
    const container = document.createElement('div');
    await renderSearchPage(container);
    const input = container.querySelector('.search-bar input[type="search"]');
    expect(input).not.toBeNull();
  });

  it('al escribir, oculta el hub y muestra resultados inline; ✕ restaura el hub', async () => {
    const { searchEverything } = await import('../lib/search.js');
    searchEverything.mockReturnValue({
      songs: [{ id: '1', title: 'Refugio', album: 'A' }], albums: [], voces: [],
    });
    getState.mockReturnValue({
      songs: [{ id: '1', title: 'Refugio', album: 'A', coverImage: '' }], filtered: [],
    });
    const container = document.createElement('div');
    await renderSearchPage(container);

    const input = container.querySelector('.search-bar input[type="search"]');
    input.value = 'refug';
    input.dispatchEvent(new Event('input'));

    expect(container.querySelector('.search-inline-results')).not.toBeNull();
    expect(container.querySelector('.search-hub').hidden).toBe(true);

    const clear = container.querySelector('.search-bar__clear');
    clear.click();
    expect(container.querySelector('.search-hub').hidden).toBe(false);
    expect(container.querySelector('.search-inline-results')).toBeNull();
  });

  it('baraja las canciones de forma estable dado un seed fijo en sessionStorage', async () => {
    sessionStorage.setItem('hkn-search-shuffle-seed', 'seed-fijo');
    const songs = Array.from({ length: 8 }, (_, i) => ({
      id: String(i), title: `T${i}`, album: 'A', coverImage: '',
    }));
    getState.mockReturnValue({ songs, filtered: songs });

    const c1 = document.createElement('div');
    await renderSearchPage(c1);
    const order1 = [...c1.querySelectorAll('.song-tile-grid .song-tile')].map(
      (t) => t.getAttribute('aria-label'),
    );

    const c2 = document.createElement('div');
    await renderSearchPage(c2);
    const order2 = [...c2.querySelectorAll('.song-tile-grid .song-tile')].map(
      (t) => t.getAttribute('aria-label'),
    );

    expect(order1).toEqual(order2); // estable con el mismo seed
    expect(order1).toHaveLength(8); // sin perder canciones
  });
});
