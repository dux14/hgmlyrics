import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mismo patrón de mocks que songEditorCover.test.js.
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));
vi.mock('../src/lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
  refreshData: vi.fn(),
  invalidateSongDetailCache: vi.fn(),
  getSongById: vi.fn(),
  getAdjacentSongs: vi.fn(),
}));
vi.mock('../src/router.js', () => ({ navigate: vi.fn(), onRouteChange: vi.fn() }));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok-1' })),
  isFeatureEnabled: vi.fn(() => false),
  isAdmin: vi.fn(() => false),
}));
vi.mock('../src/lib/sectionAudioApi.js', () => ({
  fetchSectionAudio: vi.fn().mockResolvedValue([]),
  createSectionAudio: vi.fn(),
  uploadSectionAudioFile: vi.fn(),
  deleteSectionAudio: vi.fn(),
}));
vi.mock('../src/lib/stemsApi.js', () => ({ readAudioDuration: vi.fn() }));

const store = await import('../src/lib/store.js');
const { renderSongEditor } = await import('../src/components/SongEditor.js');

function buildSong(overrides) {
  return {
    id: 'song-x',
    title: 'Canción X',
    artist: 'Hakuna Group Music',
    album: 'Álbum',
    albumOrder: 0,
    year: 2024,
    genre: '',
    cejilla: 0,
    voicePercent: { male: 50 },
    coverImage: '',
    sections: [
      { type: 'verse', label: 'Verso 1', lines: [{ text: 'Línea', chords: [] }] },
    ],
    ...overrides,
  };
}

describe('SongEditor — orden/cejilla en 0 se ven en el input (P3 auditoria)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('albumOrder=0 y cejilla=0 renderizan value="0", no vacío', async () => {
    store.fetchSongDetail.mockResolvedValueOnce(buildSong({ albumOrder: 0, cejilla: 0 }));
    await renderSongEditor(container, 'song-x');
    await vi.waitFor(() => expect(container.querySelector('#song-order')).not.toBeNull());

    expect(container.querySelector('#song-order').value).toBe('0');
    expect(container.querySelector('#song-cejilla').value).toBe('0');
  });
});

describe('SongEditor — portada existente visible al abrir el editor (P2 auditoria)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('coverImage relativo se resuelve a /covers/<archivo> en el <img> del preview', async () => {
    store.fetchSongDetail.mockResolvedValueOnce(buildSong({ coverImage: 'santo.webp' }));
    await renderSongEditor(container, 'song-x');
    await vi.waitFor(() => expect(container.querySelector('#image-preview')).not.toBeNull());

    const img = container.querySelector('#image-preview img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/covers/santo.webp');
  });

  it('coverImage con URL completa se usa tal cual', async () => {
    store.fetchSongDetail.mockResolvedValueOnce(
      buildSong({ coverImage: 'https://example.com/x.webp' }),
    );
    await renderSongEditor(container, 'song-x');
    await vi.waitFor(() => expect(container.querySelector('#image-preview')).not.toBeNull());

    const img = container.querySelector('#image-preview img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://example.com/x.webp');
  });

  it('sin coverImage no renderiza <img> en el preview', async () => {
    store.fetchSongDetail.mockResolvedValueOnce(buildSong({ coverImage: '' }));
    await renderSongEditor(container, 'song-x');
    await vi.waitFor(() => expect(container.querySelector('#image-preview')).not.toBeNull());

    expect(container.querySelector('#image-preview img')).toBeNull();
  });
});
