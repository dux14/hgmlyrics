import { describe, it, expect, vi, afterEach } from 'vitest';

// Mismo patrón de stubs que songViewLayerToolbar.test.js — render completo
// no-preview de SongView (getSongById en caché, sin fetch async).
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

vi.mock('../src/lib/store.js', () => ({
  getSongById: vi.fn(),
  filterByAlbum: vi.fn(),
  fetchSongDetail: vi.fn(),
  getAdjacentSongs: vi.fn().mockReturnValue({ prev: null, next: null }),
}));

vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
  onRouteChange: vi.fn(() => vi.fn()),
}));

vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => null,
  subscribe: () => () => {},
  isAdmin: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn(),
}));

const { renderSongView } = await import('../src/components/SongView.js');
const { getSongById } = await import('../src/lib/store.js');
const { getSongAudio } = await import('../src/lib/songAudioApi.js');

window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

globalThis.IntersectionObserver =
  globalThis.IntersectionObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

function buildSong(id) {
  return {
    id,
    title: 'Santo',
    schemaVersion: 3,
    voiceRoster: [],
    sections: [{ type: 'verse', label: 'V', lines: [{ text: 'Santo es el Señor', chords: [] }] }],
  };
}

describe('SongView — chip BPM (F4-D6)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('pinta el chip "112 BPM · 4/4" con bpm detectado y compás por defecto', async () => {
    getSongById.mockReturnValue(buildSong('song-bpm-1'));
    getSongAudio.mockResolvedValue({
      audio: { bpmManual: null, timeSignature: null },
      timings: { bpmDetected: 112.35 },
    });
    const container = document.createElement('div');
    await renderSongView(container, 'song-bpm-1');
    await vi.waitFor(() => expect(container.querySelector('.song-view__bpm')).not.toBeNull());

    expect(container.querySelector('.song-view__bpm').textContent).toBe('112 BPM · 4/4');
  });

  it('bpmManual override gana sobre bpmDetected + compás propio', async () => {
    getSongById.mockReturnValue(buildSong('song-bpm-2'));
    getSongAudio.mockResolvedValue({
      audio: { bpmManual: 130, timeSignature: '3/4' },
      timings: { bpmDetected: 112.35 },
    });
    const container = document.createElement('div');
    await renderSongView(container, 'song-bpm-2');
    await vi.waitFor(() => expect(container.querySelector('.song-view__bpm')).not.toBeNull());

    expect(container.querySelector('.song-view__bpm').textContent).toBe('130 BPM · 3/4');
  });

  it('sin datos de audio (null): no pinta el chip ni rompe', async () => {
    getSongById.mockReturnValue(buildSong('song-bpm-3'));
    getSongAudio.mockResolvedValue(null);
    const container = document.createElement('div');
    await renderSongView(container, 'song-bpm-3');
    await vi.waitFor(() => expect(getSongAudio).toHaveBeenCalled());

    expect(container.querySelector('.song-view__bpm')).toBeNull();
  });

  it('sin bpm (ni manual ni detectado): no pinta el chip', async () => {
    getSongById.mockReturnValue(buildSong('song-bpm-4'));
    getSongAudio.mockResolvedValue({
      audio: { bpmManual: null, timeSignature: null },
      timings: { bpmDetected: null },
    });
    const container = document.createElement('div');
    await renderSongView(container, 'song-bpm-4');
    await vi.waitFor(() => expect(getSongAudio).toHaveBeenCalled());

    expect(container.querySelector('.song-view__bpm')).toBeNull();
  });
});
