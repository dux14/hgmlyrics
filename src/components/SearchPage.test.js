/**
 * SearchPage.test.js — smoke tests para el browse hub y modo focus.
 * Cubre: catálogo tile-grid, sección favoritos (oculta sin auth), rail de álbumes,
 * y el modo focus estilo Spotify (body.search-focus, Cancelar, ✕, Escape, backable).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../router.js', () => ({
  navigate: vi.fn(),
  openBackable: vi.fn(),
  closeBackable: vi.fn(),
  clearBackable: vi.fn(),
}));

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
  songTile: vi.fn((song, _colors, coverBySlug) => {
    const div = document.createElement('div');
    div.className = 'song-tile';
    div.setAttribute('aria-label', `${song.title} — ${song.album}`);
    div.dataset.cover = (coverBySlug && coverBySlug[song.albumSlug]) || '';
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
import { openBackable } from '../router.js';
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

afterEach(() => {
  document.body.classList.remove('search-focus');
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

  it('coverBySlug preserva la URL http del cover del álbum (no la corta a nombre de archivo)', async () => {
    const remote =
      'https://x.supabase.co/storage/v1/object/public/covers-uploads/abc-reina.webp';
    getAlbums.mockReturnValue([
      { slug: 'reina-de-colombia', name: 'Reina de Colombia', coverImage: remote, year: 2026 },
    ]);
    getState.mockReturnValue({
      songs: [
        {
          id: '1', title: 'Reina de Colombia', album: 'Reina de Colombia',
          albumSlug: 'reina-de-colombia', coverImage: remote,
        },
      ],
      filtered: [],
    });

    const container = document.createElement('div');
    await renderSearchPage(container);

    const tile = container.querySelector('.song-tile-grid .song-tile');
    expect(tile.dataset.cover).toBe(remote);
  });

  it('baraja las canciones incluyendo todas (sin pérdidas) en cada render', async () => {
    const songs = Array.from({ length: 8 }, (_, i) => ({
      id: String(i), title: `T${i}`, album: 'A', coverImage: '',
    }));
    getState.mockReturnValue({ songs, filtered: songs });

    const container = document.createElement('div');
    await renderSearchPage(container);
    const tiles = container.querySelectorAll('.song-tile-grid .song-tile');

    expect(tiles).toHaveLength(8); // shuffle no pierde canciones
  });

  // --- Modo focus ---

  it('enfocar el input añade body.search-focus y muestra el botón Cancelar', async () => {
    getState.mockReturnValue({ songs: [], filtered: [] });
    const container = document.createElement('div');
    await renderSearchPage(container);

    const input = container.querySelector('.search-bar input[type="search"]');
    const cancelBtn = container.querySelector('.search-bar__cancel');

    expect(document.body.classList.contains('search-focus')).toBe(false);
    expect(cancelBtn.hidden).toBe(true);

    input.dispatchEvent(new Event('focus'));

    expect(document.body.classList.contains('search-focus')).toBe(true);
    expect(cancelBtn.hidden).toBe(false);
  });

  it('click en Cancelar quita search-focus, vacía el input y restaura el hub', async () => {
    getState.mockReturnValue({ songs: [], filtered: [] });
    const container = document.createElement('div');
    await renderSearchPage(container);

    const input = container.querySelector('.search-bar input[type="search"]');
    const cancelBtn = container.querySelector('.search-bar__cancel');

    input.dispatchEvent(new Event('focus'));
    expect(document.body.classList.contains('search-focus')).toBe(true);

    cancelBtn.click();

    expect(document.body.classList.contains('search-focus')).toBe(false);
    expect(input.value).toBe('');
    expect(container.querySelector('.search-hub').hidden).toBe(false);
    expect(cancelBtn.hidden).toBe(true);
  });

  it('Escape sale del focus y restaura el hub', async () => {
    getState.mockReturnValue({ songs: [], filtered: [] });
    const container = document.createElement('div');
    await renderSearchPage(container);

    const input = container.querySelector('.search-bar input[type="search"]');
    input.dispatchEvent(new Event('focus'));
    expect(document.body.classList.contains('search-focus')).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.body.classList.contains('search-focus')).toBe(false);
    expect(container.querySelector('.search-hub').hidden).toBe(false);
  });

  it('atrás nativo (callback openBackable) sale del focus; re-enfocar vuelve a abrir el backable', async () => {
    getState.mockReturnValue({ songs: [], filtered: [] });
    const container = document.createElement('div');
    await renderSearchPage(container);

    const input = container.querySelector('.search-bar input[type="search"]');
    input.dispatchEvent(new Event('focus'));
    expect(document.body.classList.contains('search-focus')).toBe(true);

    // El router mock captura el callback pasado a openBackable
    expect(openBackable).toHaveBeenCalledOnce();
    const backCallback = openBackable.mock.calls[0][0];
    backCallback();

    expect(document.body.classList.contains('search-focus')).toBe(false);
    expect(container.querySelector('.search-hub').hidden).toBe(false);

    // Re-enfocar debe volver a abrir el backable (overlayOpen se reseteó a false)
    input.dispatchEvent(new Event('focus'));
    expect(document.body.classList.contains('search-focus')).toBe(true);
    expect(openBackable).toHaveBeenCalledTimes(2);
  });

  it('✕ con texto limpia el input pero mantiene search-focus y muestra el hub', async () => {
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
    const clearBtn = container.querySelector('.search-bar__clear');

    // Entrar en focus y escribir texto
    input.dispatchEvent(new Event('focus'));
    input.value = 'refug';
    input.dispatchEvent(new Event('input'));

    // Con texto: hub oculto
    expect(container.querySelector('.search-hub').hidden).toBe(true);
    expect(clearBtn.hidden).toBe(false);

    // Click en ✕
    clearBtn.click();

    // focus se mantiene, hub vuelve (texto vacío en focus = hub visible)
    expect(document.body.classList.contains('search-focus')).toBe(true);
    expect(input.value).toBe('');
    expect(container.querySelector('.search-hub').hidden).toBe(false);
  });

  it('click en fila .search-row limpia body.search-focus antes de navegar (regresión C1)', async () => {
    const { searchEverything } = await import('../lib/search.js');
    const { navigate } = await import('../router.js');
    searchEverything.mockReturnValue({
      songs: [{ id: '42', title: 'Gracia', album: 'Álbum X', coverImage: '' }],
      albums: [], voces: [],
    });
    getState.mockReturnValue({ songs: [], filtered: [] });
    const container = document.createElement('div');
    await renderSearchPage(container);

    const input = container.querySelector('.search-bar input[type="search"]');
    input.dispatchEvent(new Event('focus'));
    input.value = 'gracia';
    input.dispatchEvent(new Event('input'));

    const row = container.querySelector('.search-row');
    expect(row).not.toBeNull();

    row.click();

    // search-focus debe haberse limpiado ANTES de navegar
    expect(document.body.classList.contains('search-focus')).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/song/42');
  });

  it('con matches → .search-row con subtítulos correctos por tipo', async () => {
    const { searchEverything } = await import('../lib/search.js');
    searchEverything.mockReturnValue({
      songs: [{ id: '1', title: 'Refugio', album: 'Nuevo Amanecer', coverImage: '' }],
      albums: [{ slug: 'na', name: 'Nuevo Amanecer', coverImage: '', artist: 'HGM' }],
      voces: [{ id: 'v1', title: 'Juan 3:16', gospel_ref: 'Juan 3:16' }],
    });
    getState.mockReturnValue({ songs: [], filtered: [] });
    const container = document.createElement('div');
    await renderSearchPage(container);

    const input = container.querySelector('.search-bar input[type="search"]');
    input.dispatchEvent(new Event('focus'));
    input.value = 'nuevo';
    input.dispatchEvent(new Event('input'));

    const rows = container.querySelectorAll('.search-row');
    expect(rows).toHaveLength(3);

    const subs = [...rows].map((r) => r.querySelector('.search-row__sub').textContent);
    expect(subs[0]).toBe('Canción · Nuevo Amanecer');
    expect(subs[1]).toBe('Álbum · HGM');
    expect(subs[2]).toBe('Voz en off · Juan 3:16');
  });

  it('query con texto y 0 matches → .search-empty visible con el texto del query', async () => {
    const { searchEverything } = await import('../lib/search.js');
    searchEverything.mockReturnValue({ songs: [], albums: [], voces: [] });
    getState.mockReturnValue({ songs: [], filtered: [] });
    const container = document.createElement('div');
    await renderSearchPage(container);

    const input = container.querySelector('.search-bar input[type="search"]');
    input.dispatchEvent(new Event('focus'));
    input.value = 'xyzzy';
    input.dispatchEvent(new Event('input'));

    const empty = container.querySelector('.search-empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('xyzzy');
  });
});
