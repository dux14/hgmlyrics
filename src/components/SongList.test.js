import { describe, it, expect, vi } from 'vitest';

vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/offlineCache.js', () => ({ isPWA: () => false, isSongCached: vi.fn() }));
vi.mock('../lib/authStore.js', () => ({ isAuthenticated: () => false }));
vi.mock('../lib/favorites.js', () => ({
  isFavorite: () => false, toggleFavorite: vi.fn(), subscribe: vi.fn(),
}));
vi.mock('./songRow.js', () => ({
  resolveCoverUrl: () => 'cover.jpg',
  voiceBadge: () => ({ class: 'vb', label: 'Mixta' }),
}));

import { createSongListRow } from './SongList.js';

const song = { id: '1', title: 'A Ti te alabo', album: 'Tú', artist: 'HGM', year: 2026, genre: 'Worship' };

describe('createSongListRow — fila limpia', () => {
  it('muestra carátula, título, álbum y badge de voz', () => {
    const row = createSongListRow(song);
    expect(row.querySelector('img')).not.toBeNull();
    expect(row.textContent).toContain('A Ti te alabo');
    expect(row.textContent).toContain('Tú');
    expect(row.querySelector('.voice-badge').textContent).toContain('Mixta');
  });

  it('no incluye artista, año ni género', () => {
    const row = createSongListRow(song);
    expect(row.textContent).not.toContain('HGM');
    expect(row.textContent).not.toContain('2026');
    expect(row.textContent).not.toContain('Worship');
  });
});
