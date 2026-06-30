import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/search.js', () => ({
  normalize: (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim(),
  searchSongs: vi.fn(),
}));
vi.mock('../lib/store.js', () => ({
  getAlbums: vi.fn(),
  getState: vi.fn(() => ({ songs: [] })),
}));
vi.mock('./songRow.js', () => ({ resolveCoverUrl: () => 'cover.jpg' }));
vi.mock('./ThemeToggle.js', () => ({ getTheme: () => 'dark', applyTheme: vi.fn() }));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));

import { buildResults } from './CommandPalette.js';
import { searchSongs } from '../lib/search.js';
import { getAlbums, getState } from '../lib/store.js';

beforeEach(() => {
  vi.clearAllMocks();
  searchSongs.mockReturnValue([]);
  getAlbums.mockReturnValue([]);
  getState.mockReturnValue({ songs: [] });
});

describe('buildResults', () => {
  it('query vacio devuelve solo el grupo Acciones con todos los actions', () => {
    const groups = buildResults('');
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Acciones');
    expect(groups[0].items.length).toBeGreaterThan(5);
    expect(groups[0].items.every((i) => i.kind === 'action')).toBe(true);
  });

  it('con cancion y album, devuelve grupos en orden Canciones->Albumes->Acciones', () => {
    searchSongs.mockReturnValue([{ id: '1', title: 'Song', artist: 'HGM', album: 'Disco' }]);
    getAlbums.mockReturnValue([{ slug: 'album', name: 'Album Test', coverImage: 'c.jpg' }]);
    getState.mockReturnValue({ songs: [{ id: '1', albumSlug: 'album' }] });
    const groups = buildResults('a');
    expect(groups.map((g) => g.label)).toEqual(['Canciones', 'Albumes', 'Acciones']);
  });

  it('cancion tiene subtitle, cover y run correctos', () => {
    searchSongs.mockReturnValue([{ id: '1', title: 'Song', artist: 'HGM', album: 'Disco' }]);
    const groups = buildResults('song');
    const songGroup = groups.find((g) => g.label === 'Canciones');
    const item = songGroup.items[0];
    expect(item.subtitle).toBe('HGM · Disco');
    expect(item.cover).toBe('cover.jpg');
    expect(typeof item.run).toBe('function');
  });

  it('albumes: cuenta canciones por albumSlug y limita a 3', () => {
    const albums = [
      { slug: 'a', name: 'Test A', coverImage: '' },
      { slug: 'b', name: 'Test B', coverImage: '' },
      { slug: 'c', name: 'Test C', coverImage: '' },
      { slug: 'd', name: 'Test D', coverImage: '' },
    ];
    getAlbums.mockReturnValue(albums);
    getState.mockReturnValue({
      songs: [
        { albumSlug: 'a' },
        { albumSlug: 'a' },
        { albumSlug: 'b' },
        { albumSlug: 'c' },
        { albumSlug: 'c' },
        { albumSlug: 'c' },
        { albumSlug: 'd' },
      ],
    });
    const groups = buildResults('test');
    const albumGroup = groups.find((g) => g.label === 'Albumes');
    expect(albumGroup.items).toHaveLength(3);
    expect(albumGroup.items[0].subtitle).toBe('2 canciones');
  });

  it('busqueda con acento encuentra la accion sin acento', () => {
    const groups = buildResults('oracion');
    const actionGroup = groups.find((g) => g.label === 'Acciones');
    expect(actionGroup?.items.some((i) => i.title === 'Ir a Oracion')).toBe(true);
  });

  it('omite grupos vacios: con query sin matches no retorna grupos vacios', () => {
    const groups = buildResults('zzzzznomatch');
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});
