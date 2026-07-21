import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub supabase (requires env vars not available in test) — mismo patrón que
// songViewPipelineEntry.test.js.
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
  isFeatureEnabled: vi.fn((key) => key === 'voz_tono'),
}));

vi.mock('../src/lib/pipelineApi.js', () => ({
  getPipelineRun: vi.fn(),
}));

vi.mock('../src/lib/studioApi.js', () => ({
  getSongStudio: vi.fn(),
}));

const { renderSongView } = await import('../src/components/SongView.js');
const { getSongById } = await import('../src/lib/store.js');
const { isAdmin } = await import('../src/lib/authStore.js');
const { getPipelineRun } = await import('../src/lib/pipelineApi.js');
const { getSongStudio } = await import('../src/lib/studioApi.js');
const { navigate } = await import('../src/router.js');

// jsdom no implementa matchMedia ni IntersectionObserver.
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
    sections: [
      {
        type: 'verse',
        label: 'V',
        lines: [{ text: 'Santo es el Señor', chords: [], groups: [] }],
      },
    ],
  };
}

// Espera a que el fetch async de getSongStudio (dentro de una IIFE en
// renderSongView) resuelva y pinte el acceso.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('SongView — acceso al Estudio publico desde la vista de cancion (D4e)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('no admin + estudio publicado con stems: el acceso existe y navega al hacer click', async () => {
    isAdmin.mockReturnValue(false);
    getPipelineRun.mockResolvedValue(null);
    getSongStudio.mockResolvedValue({ stems: [{ kind: 'vocals' }] });
    const song = buildSong('song-studio-1');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-studio-1');
    await flushMicrotasks();

    const btn = container.querySelector('#open-studio-btn');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Estudio');

    btn.click();
    expect(navigate).toHaveBeenCalledWith('/song/song-studio-1/estudio');
  });

  it('no admin + sin estudio publicado (null): el acceso no aparece', async () => {
    isAdmin.mockReturnValue(false);
    getPipelineRun.mockResolvedValue(null);
    getSongStudio.mockResolvedValue(null);
    const song = buildSong('song-studio-2');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-studio-2');
    await flushMicrotasks();

    expect(container.querySelector('#open-studio-btn')).toBeNull();
  });
});
