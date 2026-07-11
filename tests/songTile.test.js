// tests/songTile.test.js
import { describe, it, expect } from 'vitest';
import { songTile } from '../src/components/songTile.js';

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
});
