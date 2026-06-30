import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/store.js', () => ({
  getState: vi.fn(() => ({ songs: [] })),
}));
vi.mock('./songRow.js', () => ({
  resolveCoverUrl: vi.fn((s) => `/covers/${s.coverImage || ''}`),
  songRowCompact: vi.fn(
    (song) =>
      `<div class="song-row-compact" data-song-id="${song.id}"><span class="song-row-compact__title">${song.title}</span></div>`,
  ),
}));
vi.mock('../router.js', () => ({
  navigate: vi.fn(),
}));
vi.mock('../lib/icons.js', () => ({
  icon: vi.fn(() => ''),
  COVER_PLACEHOLDER: '/placeholder.svg',
}));

import { renderAlbumDetail } from './AlbumDetail.js';
import { getState } from '../lib/store.js';
import { navigate } from '../router.js';
import { songRowCompact } from './songRow.js';

const SONGS_FIXTURE = [
  {
    id: 's1',
    title: 'Canción Uno',
    album: 'Álbum Test',
    albumSlug: 'album-test',
    albumOrder: 1,
    artist: 'Artista Test',
    coverImage: 'test.jpg',
    year: 2023,
  },
  {
    id: 's2',
    title: 'Canción Dos',
    album: 'Álbum Test',
    albumSlug: 'album-test',
    albumOrder: 2,
    artist: 'Artista Test',
    coverImage: 'test.jpg',
    year: 2023,
  },
  {
    id: 's3',
    title: 'Otro Álbum Song',
    album: 'Otro',
    albumSlug: 'otro',
    albumOrder: 1,
    artist: 'Otro Artista',
    coverImage: 'otro.jpg',
    year: 2022,
  },
];

describe('renderAlbumDetail', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    vi.clearAllMocks();
  });

  // — Hero —

  it('muestra el nombre del álbum en el hero', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    expect(container.textContent).toContain('Álbum Test');
  });

  it('muestra el artista del álbum en el hero', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    expect(container.textContent).toContain('Artista Test');
  });

  it('muestra "2 canciones" cuando el álbum tiene dos canciones', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    expect(container.textContent).toContain('2 canciones');
  });

  it('muestra "1 canción" (singular) cuando el álbum tiene una sola canción', () => {
    getState.mockReturnValue({ songs: [SONGS_FIXTURE[0]] });
    renderAlbumDetail(container, 'album-test');
    expect(container.textContent).toContain('1 canción');
  });

  // — Tracklist —

  it('llama a songRowCompact por cada canción del álbum', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    expect(songRowCompact).toHaveBeenCalledTimes(2);
  });

  it('filtra solo las canciones del slug dado (excluye otros álbumes)', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    const songIds = songRowCompact.mock.calls.map(([song]) => song.id);
    expect(songIds).not.toContain('s3');
    expect(songIds).toContain('s1');
    expect(songIds).toContain('s2');
  });

  it('ordena la tracklist por albumOrder (ascendente)', () => {
    const shuffled = [
      { ...SONGS_FIXTURE[1] }, // albumOrder: 2
      { ...SONGS_FIXTURE[0] }, // albumOrder: 1
    ];
    getState.mockReturnValue({ songs: shuffled });
    renderAlbumDetail(container, 'album-test');
    const calls = songRowCompact.mock.calls;
    expect(calls[0][0].id).toBe('s1'); // albumOrder 1 primero
    expect(calls[1][0].id).toBe('s2'); // albumOrder 2 segundo
  });

  it('pasa el índice (base 1) a songRowCompact', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    expect(songRowCompact.mock.calls[0][1]).toMatchObject({ index: 1 });
    expect(songRowCompact.mock.calls[1][1]).toMatchObject({ index: 2 });
  });

  // — Navegación —

  it('al hacer click en una fila de canción navega a /song/:id', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    const rows = container.querySelectorAll('.song-row-compact');
    rows[0].click();
    expect(navigate).toHaveBeenCalledWith('/song/s1');
  });

  it('al hacer click en la segunda fila navega al id correcto', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    const rows = container.querySelectorAll('.song-row-compact');
    rows[1].click();
    expect(navigate).toHaveBeenCalledWith('/song/s2');
  });

  // — Estado vacío —

  it('álbum inexistente (slug sin canciones): no lanza error', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    expect(() => renderAlbumDetail(container, 'no-existe')).not.toThrow();
  });

  it('álbum inexistente: muestra mensaje de estado vacío', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'no-existe');
    expect(container.textContent.toLowerCase()).toMatch(/no (se encontr|encontrado)/);
  });

  it('álbum inexistente: no llama a songRowCompact', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'no-existe');
    expect(songRowCompact).not.toHaveBeenCalled();
  });

  // — Breadcrumb —

  it('incluye breadcrumb con Inicio, Álbumes y nombre del álbum', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    const breadcrumb = container.querySelector('.breadcrumb');
    expect(breadcrumb.textContent).toContain('Inicio');
    expect(breadcrumb.textContent).toContain('Álbumes');
    expect(breadcrumb.textContent).toContain('Álbum Test');
  });

  it('el link de Inicio en el breadcrumb navega a /', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    container.querySelector('.album-detail__home-link').click();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('el link de Álbumes en el breadcrumb navega a /albumes', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'album-test');
    container.querySelector('.album-detail__albums-link').click();
    expect(navigate).toHaveBeenCalledWith('/albumes');
  });

  it('en estado vacío el breadcrumb también tiene links de Inicio y Álbumes', () => {
    getState.mockReturnValue({ songs: SONGS_FIXTURE });
    renderAlbumDetail(container, 'no-existe');
    expect(container.querySelector('.album-detail__home-link')).toBeTruthy();
    expect(container.querySelector('.album-detail__albums-link')).toBeTruthy();
  });
});
