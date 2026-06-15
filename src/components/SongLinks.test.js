/**
 * SEC-03: Tests de escape XSS para SongLinks (year, genre, key)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del CSS import (jsdom no lo soporta)
vi.mock('../styles/song-links.css', () => ({}));

vi.mock('../lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
}));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/voiceSystem.js', () => ({
  VOICE_TYPES: [],
  getVoiceColor: vi.fn(() => '#000'),
}));
vi.mock('../lib/authStore.js', () => ({ isAdmin: vi.fn(() => false) }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));

import { renderSongLinks } from './SongLinks.js';
import { fetchSongDetail } from '../lib/store.js';

describe('renderSongLinks — SEC-03: year, genre, key escapados', () => {
  beforeEach(() => {
    // Mock global fetch para la llamada a /api/songs/:id/links
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ platforms: [], voices: [] }) }),
    );
  });

  it('no inyecta HTML ejecutable desde song.genre, year y key', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const song = {
      id: 'song-1',
      title: 'Mi cancion',
      artist: 'Artista',
      album: 'Album',
      year: payload,
      genre: payload,
      key: payload,
      coverImage: '',
    };
    fetchSongDetail.mockResolvedValue(song);

    const container = document.createElement('div');
    await renderSongLinks(container, 'song-1');

    // No debe haber <img> con onerror en el DOM
    expect(container.querySelector('img[onerror]')).toBeNull();

    // El parrafo de año/género/key debe mostrar los valores escapados como texto
    const yearEl = container.querySelector('.slinks__year');
    expect(yearEl).toBeTruthy();
    expect(yearEl.textContent).toContain('<img');
    expect(yearEl.innerHTML).toContain('&lt;img');
  });
});
