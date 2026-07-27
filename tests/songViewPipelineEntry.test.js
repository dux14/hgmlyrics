import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub supabase (requires env vars not available in test) — mismo patrón que
// songViewLayerToolbar.test.js.
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

vi.mock('../src/lib/pipelineApi.js', () => ({
  getPipelineRun: vi.fn(),
}));

const { renderSongView } = await import('../src/components/SongView.js');
const { getSongById } = await import('../src/lib/store.js');
const { isAdmin } = await import('../src/lib/authStore.js');
const { getPipelineRun } = await import('../src/lib/pipelineApi.js');
const { closeSongActionsSheet } = await import('../src/components/SongActionsSheet.js');

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

// Espera a que el fetch async de getPipelineRun (dentro de una IIFE en
// renderSongView) resuelva y actualice el estado del sheet de acciones.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('SongView — botón "más" y sheet de acciones (Task 18)', () => {
  afterEach(() => {
    closeSongActionsSheet();
    document.body.innerHTML = '';
  });

  it('admin + run awaiting_lyrics: el sheet muestra Procesamiento con sub-label "Esperando letra" y el botón "más" queda con punto need', async () => {
    isAdmin.mockReturnValue(true);
    getPipelineRun.mockResolvedValue({ run: { status: 'awaiting_lyrics' } });
    const song = buildSong('song-pipeline-1');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-pipeline-1');
    await flushMicrotasks();

    const moreBtn = container.querySelector('.song-toolbar #open-song-actions-btn');
    expect(moreBtn).toBeTruthy();
    const badge = moreBtn.querySelector('.song-actions-badge');
    expect(badge.hidden).toBe(false);
    expect(badge.classList.contains('need')).toBe(true);

    moreBtn.click();
    const pipelineItem = document.querySelector('[data-sasheet-item="pipeline"]');
    expect(pipelineItem).toBeTruthy();
    expect(pipelineItem.textContent).toContain('Procesamiento');
    expect(pipelineItem.textContent).toContain('Esperando letra');
  });

  it('admin + run processing: el punto queda proc', async () => {
    isAdmin.mockReturnValue(true);
    getPipelineRun.mockResolvedValue({ run: { status: 'processing' } });
    const song = buildSong('song-pipeline-2');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-pipeline-2');
    await flushMicrotasks();

    const moreBtn = container.querySelector('#open-song-actions-btn');
    const badge = moreBtn.querySelector('.song-actions-badge');
    expect(badge.hidden).toBe(false);
    expect(badge.classList.contains('proc')).toBe(true);
  });

  it('admin + sin run activo (null): el punto queda oculto', async () => {
    isAdmin.mockReturnValue(true);
    getPipelineRun.mockResolvedValue(null);
    const song = buildSong('song-pipeline-3');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-pipeline-3');
    await flushMicrotasks();

    const moreBtn = container.querySelector('#open-song-actions-btn');
    const badge = moreBtn.querySelector('.song-actions-badge');
    expect(badge.hidden).toBe(true);
    expect(badge.classList.contains('need')).toBe(false);
    expect(badge.classList.contains('proc')).toBe(false);
  });

  it('no admin: Editar canción y Procesamiento no aparecen en el sheet', async () => {
    isAdmin.mockReturnValue(false);
    const song = buildSong('song-pipeline-4');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-pipeline-4');
    await flushMicrotasks();

    const moreBtn = container.querySelector('#open-song-actions-btn');
    expect(moreBtn).toBeTruthy();
    moreBtn.click();
    expect(document.querySelector('[data-sasheet-item="edit-song"]')).toBeNull();
    expect(document.querySelector('[data-sasheet-item="pipeline"]')).toBeNull();
  });
});
