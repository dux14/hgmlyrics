/**
 * SEC-03: Tests de escape XSS para SongView
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/store.js', () => ({
  getSongById: vi.fn(),
  filterByAlbum: vi.fn(),
  fetchSongDetail: vi.fn(),
  getAdjacentSongs: vi.fn(() => ({ prev: null, next: null, currentIndex: 0, total: 0 })),
}));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/voiceSystem.js', () => ({
  upgradeLegacySong: vi.fn((s) => s),
  rosterByCategory: vi.fn(() => []),
  getVoiceLabel: vi.fn((c) => c),
  tonoGeneralForVoice: vi.fn(() => null),
  firstNoteForVoice: vi.fn(() => null),
}));
vi.mock('../lib/lyricsRender.js', () => ({
  buildLetraLineHTML: vi.fn((t) => t),
  buildChordsLineHTML: vi.fn((t) => t),
  buildTonoLineHTML: vi.fn((t) => t),
  buildMixedLineHTML: vi.fn((t) => t),
}));
vi.mock('../lib/authStore.js', () => ({
  isAdmin: vi.fn(() => false),
  isFeatureEnabled: vi.fn(() => false),
}));
vi.mock('../lib/icons.js', () => ({
  icon: vi.fn(() => ''),
  COVER_PLACEHOLDER: '',
}));
vi.mock('../lib/autoscroll.js', () => ({
  presetToSpeed: vi.fn(),
  stepToward: vi.fn(),
  shouldShowFab: vi.fn(() => false),
}));

import { renderSections } from './SongView.js';
import { getSongById, fetchSongDetail } from '../lib/store.js';
import { renderSongView } from './SongView.js';

describe('renderSections — SEC-03: sección label escapado', () => {
  it('no inyecta HTML ejecutable desde section.label con payload XSS', () => {
    const payload = '<script>alert(1)</script>';
    const sections = [{ type: 'verse', label: payload, lines: [] }];
    const html = renderSections(sections);
    const el = document.createElement('div');
    el.innerHTML = html;

    // El <script> no debe existir como elemento real en el DOM
    expect(el.querySelector('script')).toBeNull();
    // El label debe aparecer escapado como texto
    const labelEl = el.querySelector('.lyrics__section-label');
    expect(labelEl.textContent).toContain('<script>');
    expect(labelEl.innerHTML).toContain('&lt;script&gt;');
  });
});

describe('renderSongView — SEC-03: year y genre escapados en metadatos', () => {
  it('no inyecta HTML ejecutable desde song.genre y song.year', async () => {
    const genrePayload = '<img src=x onerror=alert(1)>';
    const yearPayload = '"><script>evil()</script>';
    const song = {
      id: 'test-1',
      title: 'Mi cancion',
      artist: 'Artista',
      album: 'Album',
      albumSlug: 'album',
      year: yearPayload,
      genre: genrePayload,
      sections: [{ type: 'verse', label: 'Verso', lines: [] }],
      voiceRoster: [],
      voiceType: 'mixed',
      voicePercent: { male: 50 },
    };

    getSongById.mockReturnValue(song);
    fetchSongDetail.mockResolvedValue(song);

    const container = document.createElement('div');
    // Render como preview (objeto directo) para evitar IntersectionObserver/FAB
    await renderSongView(container, { ...song, isPreview: true });

    // No debe haber <img> con onerror ni <script> en el DOM
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();

    // El texto del año debe aparecer escapado
    const yearEl = container.querySelector('.song-view__year');
    expect(yearEl).toBeTruthy();
    expect(yearEl.textContent).toContain('"><script>');
    expect(yearEl.textContent).toContain('<img');
  });
});
