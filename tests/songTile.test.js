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
});
