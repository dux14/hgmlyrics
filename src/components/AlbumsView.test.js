import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/store.js', () => ({
  getAlbums: vi.fn(() => []),
}));
vi.mock('./songRow.js', () => ({
  resolveCoverUrl: vi.fn((s) => `/covers/${s.coverImage || ''}`),
}));
vi.mock('../router.js', () => ({
  navigate: vi.fn(),
}));
vi.mock('../lib/icons.js', () => ({
  icon: vi.fn(() => ''),
  COVER_PLACEHOLDER: '/placeholder.svg',
}));

import { renderAlbumsView } from './AlbumsView.js';
import { getAlbums } from '../lib/store.js';
import { navigate } from '../router.js';

const ALBUMS_FIXTURE = [
  { slug: 'album-uno', name: 'Álbum Uno', coverImage: 'uno.jpg', artist: 'Artista Uno' },
  { slug: 'album-dos', name: 'Álbum Dos', coverImage: 'dos.jpg', artist: 'Artista Dos' },
];

describe('renderAlbumsView', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    vi.clearAllMocks();
  });

  it('pinta una card por álbum devuelto por getAlbums()', () => {
    getAlbums.mockReturnValue(ALBUMS_FIXTURE);
    renderAlbumsView(container);
    expect(container.querySelectorAll('.album-card')).toHaveLength(2);
  });

  it('muestra el nombre del álbum en cada card', () => {
    getAlbums.mockReturnValue(ALBUMS_FIXTURE);
    renderAlbumsView(container);
    const cards = container.querySelectorAll('.album-card');
    expect(cards[0].textContent).toContain('Álbum Uno');
    expect(cards[1].textContent).toContain('Álbum Dos');
  });

  it('muestra etiqueta "Álbum · <artista>" cuando el álbum tiene artista', () => {
    getAlbums.mockReturnValue([
      { slug: 'album-a', name: 'Álbum A', coverImage: 'a.jpg', artist: 'Artista A' },
    ]);
    renderAlbumsView(container);
    expect(container.textContent).toContain('Álbum · Artista A');
  });

  it('omite la etiqueta de artista cuando artist es undefined', () => {
    getAlbums.mockReturnValue([
      { slug: 'sin-artista', name: 'Sin Artista', coverImage: 'x.jpg', artist: undefined },
    ]);
    renderAlbumsView(container);
    expect(container.textContent).not.toContain('Álbum ·');
  });

  it('omite la etiqueta de artista cuando artist es cadena vacía', () => {
    getAlbums.mockReturnValue([
      { slug: 'sin-artista', name: 'Sin Artista', coverImage: 'x.jpg', artist: '' },
    ]);
    renderAlbumsView(container);
    expect(container.textContent).not.toContain('Álbum ·');
  });

  it('cada card navega a /album/:slug al hacer click', () => {
    getAlbums.mockReturnValue([
      { slug: 'album-a', name: 'Álbum A', coverImage: 'a.jpg', artist: 'Artista A' },
    ]);
    renderAlbumsView(container);
    container.querySelector('.album-card').click();
    expect(navigate).toHaveBeenCalledWith('/album/album-a');
  });

  it('cada card navega al slug correcto (múltiples cards)', () => {
    getAlbums.mockReturnValue(ALBUMS_FIXTURE);
    renderAlbumsView(container);
    const cards = container.querySelectorAll('.album-card');
    cards[1].click();
    expect(navigate).toHaveBeenCalledWith('/album/album-dos');
  });

  it('renderiza aunque getAlbums() devuelva arreglo vacío', () => {
    getAlbums.mockReturnValue([]);
    renderAlbumsView(container);
    expect(container.querySelectorAll('.album-card')).toHaveLength(0);
    expect(container.textContent).toContain('Álbumes');
  });

  it('incluye breadcrumb con enlace a Inicio', () => {
    getAlbums.mockReturnValue([]);
    renderAlbumsView(container);
    const homeLink = container.querySelector('.breadcrumb a');
    expect(homeLink).toBeTruthy();
    expect(homeLink.textContent.trim()).toBe('Inicio');
  });

  it('el enlace de breadcrumb navega a / al hacer click', () => {
    getAlbums.mockReturnValue([]);
    renderAlbumsView(container);
    const homeLink = container.querySelector('.breadcrumb a');
    homeLink.click();
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
