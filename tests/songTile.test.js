// tests/songTile.test.js
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/coverColor.js', () => ({
  extractCoverColor: vi.fn(() => ({ base: '#111111', light: '#222222' })),
}));
import { songTile } from '../src/components/songTile.js';
import { extractCoverColor } from '../src/lib/coverColor.js';

describe('songTile', () => {
  it('muestra el artista de la canción en el subtítulo', () => {
    const el = songTile({ id: 1, title: 'Santo', artist: 'Luispo', album: 'X', albumSlug: 'x' });
    expect(el.querySelector('.song-tile__group').textContent).toBe('Luispo');
  });

  it('cae a Hakuna Group Music sin artista', () => {
    const el = songTile({ id: 2, title: 'Santo', album: 'X', albumSlug: 'x' });
    expect(el.querySelector('.song-tile__group').textContent).toBe('Hakuna Group Music');
  });

  it('no usa crossOrigin en la portada visible (mezclar modos rompe la caché del SW)', () => {
    const el = songTile({
      id: 3,
      title: 'X',
      album: 'Y',
      albumSlug: 'z',
      coverImage: 'https://x.supabase.co/storage/v1/object/public/covers-uploads/a.webp',
    });
    const art = el.querySelector('.song-tile__art');
    expect(art.crossOrigin).toBeFalsy();
  });

  it('#9 perf: memoiza el color extraído por URL de portada, sin repetir la extracción en renders sucesivos', () => {
    extractCoverColor.mockClear();
    // jsdom no dispara 'load' de una Image real: se stubea Image por una
    // fake que llama al handler de 'load' sincrónicamente al asignar `src`,
    // simulando la Image auxiliar (probe) que songTile crea para extraer color.
    class FakeImage {
      set src(v) {
        this._src = v;
        this._onload?.();
      }
      get src() {
        return this._src;
      }
      addEventListener(evt, fn) {
        if (evt === 'load') this._onload = fn;
      }
    }
    const OriginalImage = global.Image;
    global.Image = FakeImage;
    try {
      const song = {
        id: 4,
        title: 'X',
        album: 'Y',
        albumSlug: 'sin-slug', // sin match en coverBySlug: usa song.coverImage
        coverImage: 'https://x.supabase.co/storage/v1/object/public/covers-uploads/memo.webp',
      };
      songTile(song);
      expect(extractCoverColor).toHaveBeenCalledTimes(1);
      // Segundo render de la MISMA portada: el color ya quedó cacheado, no
      // se crea una segunda Image auxiliar ni se vuelve a extraer.
      songTile(song);
      expect(extractCoverColor).toHaveBeenCalledTimes(1);
    } finally {
      global.Image = OriginalImage;
    }
  });
});
