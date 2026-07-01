import { describe, it, expect, beforeEach, vi } from 'vitest';

// Estas dependencias se moquean para que el módulo cargue sin red ni IndexedDB.
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./authStore.js', () => ({
  getSession: () => null,
  subscribe: () => () => {},
}));

import { getAlbums, _setSongs } from './store.js';

describe('getAlbums', () => {
  beforeEach(() => {
    _setSongs([]);
  });

  it('devuelve array vacío cuando no hay canciones', () => {
    expect(getAlbums()).toEqual([]);
  });

  it('conserva campos previos: slug, name, coverImage', () => {
    _setSongs([
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'Artista X' },
    ]);
    const albums = getAlbums();
    expect(albums).toHaveLength(1);
    expect(albums[0]).toMatchObject({ slug: 'album-a', name: 'Album A', coverImage: 'a.jpg' });
  });

  it('expone el artista más frecuente del álbum', () => {
    _setSongs([
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'Artista X' },
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'Artista Y' },
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'Artista X' },
    ]);
    const albums = getAlbums();
    expect(albums[0].artist).toBe('Artista X');
  });

  /**
   * Desempate: cuando dos artistas tienen la misma frecuencia, gana el primero
   * encontrado en el array de canciones (orden de inserción en el Map interno).
   */
  it('en empate de frecuencia, gana el primer artista encontrado', () => {
    _setSongs([
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'Artista A' },
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'Artista B' },
    ]);
    const albums = getAlbums();
    expect(albums[0].artist).toBe('Artista A');
  });

  it('artist es undefined cuando ninguna canción del álbum tiene artista', () => {
    _setSongs([
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg' },
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: '' },
    ]);
    const albums = getAlbums();
    expect(albums[0].artist).toBeUndefined();
  });

  it('calcula artista de forma independiente por álbum', () => {
    _setSongs([
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'X' },
      { albumSlug: 'album-b', album: 'Album B', coverImage: 'b.jpg', artist: 'Y' },
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'X' },
      { albumSlug: 'album-b', album: 'Album B', coverImage: 'b.jpg', artist: 'Y' },
    ]);
    const albums = getAlbums();
    const a = albums.find((al) => al.slug === 'album-a');
    const b = albums.find((al) => al.slug === 'album-b');
    expect(a.artist).toBe('X');
    expect(b.artist).toBe('Y');
  });

  it('deduplica álbumes (un objeto por albumSlug)', () => {
    _setSongs([
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'X' },
      { albumSlug: 'album-a', album: 'Album A', coverImage: 'a.jpg', artist: 'X' },
      { albumSlug: 'album-b', album: 'Album B', coverImage: 'b.jpg', artist: 'Y' },
    ]);
    expect(getAlbums()).toHaveLength(2);
  });

  it('incluye year = máximo año de las canciones del álbum', () => {
    _setSongs([
      { id: '1', album: 'A', albumSlug: 'a', coverImage: 'a.webp', year: 2020 },
      { id: '2', album: 'A', albumSlug: 'a', coverImage: 'a.webp', year: 2024 },
      { id: '3', album: 'B', albumSlug: 'b', coverImage: 'b.webp' },
    ]);
    const byslug = Object.fromEntries(getAlbums().map((al) => [al.slug, al]));
    expect(byslug.a.year).toBe(2024);
    expect(byslug.b.year).toBeUndefined();
  });
});
