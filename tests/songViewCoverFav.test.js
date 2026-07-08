import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub supabase (requires env vars not available in test) — mismo patrón que
// songViewStageWiring.test.js.
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
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}));

let favState = false;
const toggleFavorite = vi.fn(async () => {
  favState = !favState;
  return favState;
});
vi.mock('../src/lib/favorites.js', () => ({
  isFavorite: vi.fn(() => favState),
  toggleFavorite: (...args) => toggleFavorite(...args),
  subscribe: vi.fn(() => () => {}),
}));

const { renderSongView } = await import('../src/components/SongView.js');
const { getSongById } = await import('../src/lib/store.js');
const { COVER_PLACEHOLDER } = await import('../src/lib/icons.js');

// jsdom no implementa matchMedia ni IntersectionObserver; setupAutoscroll los
// usa para reduced-motion y los presets de velocidad por sección.
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

function buildSong(id, { coverImage = '/covers/santo.webp' } = {}) {
  return {
    id,
    title: 'Santo',
    schemaVersion: 3,
    coverImage,
    sections: [{ type: 'verse', label: 'V', lines: [{ text: 'Santo es el Señor', groups: [] }] }],
  };
}

describe('SongView — favorito sobre la carátula (hero sin degradado)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    favState = false;
    toggleFavorite.mockClear();
  });

  it('el fav-btn vive dentro de .song-view__cover-wrap con el aria-label esperado', async () => {
    const song = buildSong('song-cover-1');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-cover-1');

    const wrap = container.querySelector('.song-view__cover-wrap');
    expect(wrap).toBeTruthy();
    const favBtn = wrap.querySelector('#fav-btn');
    expect(favBtn).toBeTruthy();
    expect(favBtn.getAttribute('aria-label')).toBe('Agregar a favoritos');
  });

  it('la toolbar ya no tiene fav-btn', async () => {
    const song = buildSong('song-cover-2');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-cover-2');

    const toolbar = container.querySelector('.song-toolbar');
    expect(toolbar).toBeTruthy();
    expect(toolbar.querySelector('#fav-btn')).toBeNull();
  });

  it('sin carátula: el wrap y el fav-btn se pintan igual, con el placeholder como src', async () => {
    const song = buildSong('song-cover-4', { coverImage: '' });
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-cover-4');

    const wrap = container.querySelector('.song-view__cover-wrap');
    expect(wrap).toBeTruthy();
    expect(wrap.querySelector('#fav-btn')).toBeTruthy();
    expect(wrap.querySelector('.song-view__cover').getAttribute('src')).toBe(COVER_PLACEHOLDER);
  });

  it('el click en el fav-btn de la carátula sigue toggleando la clase is-on', async () => {
    const song = buildSong('song-cover-3');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-cover-3');

    const favBtn = container.querySelector('.song-view__cover-wrap #fav-btn');
    expect(favBtn.classList.contains('is-on')).toBe(false);
    expect(favBtn.getAttribute('aria-pressed')).toBe('false');

    favBtn.click();
    await vi.waitFor(() => expect(toggleFavorite).toHaveBeenCalledWith('song-cover-3'));
    expect(favBtn.classList.contains('is-on')).toBe(true);
    expect(favBtn.getAttribute('aria-pressed')).toBe('true');
    expect(favBtn.getAttribute('aria-label')).toBe('Quitar de favoritos');
  });
});
