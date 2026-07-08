import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SongEditor + el SongView REAL (sin mockear): la vista previa por sección debe
// reusar renderSections, el mismo pipeline del lector — no una imitación. Se
// mockean solo las dependencias con efectos de red/DOM/idb-keyval (mismo
// patrón que songViewRender.test.js para poder importar SongView.js real).
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

const FAKE_SONG = {
  id: 'song-1',
  title: 'Canción X',
  artist: 'Hakuna Group Music',
  album: 'Álbum',
  albumOrder: 1,
  year: 2024,
  genre: '',
  cejilla: 0,
  voicePercent: { male: 50 },
  coverImage: '',
  sections: [
    {
      type: 'verse',
      label: 'Verso 1',
      lines: [{ text: 'Primera línea', chords: [{ pos: 0, ch: 'C' }] }],
    },
  ],
};

describe('SongEditor — vista previa en vivo por sección', () => {
  let container;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    store.fetchSongDetail.mockResolvedValue({ ...FAKE_SONG, sections: [...FAKE_SONG.sections] });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  async function renderAndOpenPreview() {
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('.section-preview__toggle')).not.toBeNull());
    container.querySelector('.section-preview__toggle').click();
  }

  it('el toggle empieza colapsado y sin panel', async () => {
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('.section-preview__toggle')).not.toBeNull());
    expect(container.querySelector('.section-preview__toggle').getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(container.querySelector('.section-preview__panel')).toBeNull();
  });

  it('al expandir, pinta el contenido real vía renderSections (letra + acorde)', async () => {
    await renderAndOpenPreview();
    const panel = container.querySelector('.section-preview__panel');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Primera línea');
    // Notación global por defecto es 'anglo' (getChordNotation) → C se pinta "C".
    expect(panel.querySelector('.chord-label')?.textContent).toBe('C');
  });

  it('debounce: varias ediciones seguidas producen UN solo repintado, 300ms tras la última', async () => {
    await renderAndOpenPreview();
    vi.useFakeTimers();

    const input = container.querySelector('[data-action="edit-text"]');
    const panel = () => container.querySelector('.section-preview__panel');

    input.value = 'Primero';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(panel().textContent).toContain('Primera línea'); // aún no repintó

    await vi.advanceTimersByTimeAsync(200);
    // Segunda edición antes de que venza el debounce: reinicia el temporizador.
    input.value = 'Primero luego';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(panel().textContent).toContain('Primera línea'); // sigue sin repintar

    await vi.advanceTimersByTimeAsync(250);
    expect(panel().textContent).toContain('Primera línea'); // 250ms < 300ms desde la 2da edición

    await vi.advanceTimersByTimeAsync(60);
    expect(panel().textContent).toContain('Primero luego'); // 310ms desde la 2da edición → repintó
    expect(panel().textContent).not.toContain('Primera línea');
  });

  it('notación global latin explícita: el mismo acorde se pinta como "Do" (no "C")', async () => {
    localStorage.setItem('hkn-chord-notation', 'latin');
    await renderAndOpenPreview();
    const panel = container.querySelector('.section-preview__panel');
    expect(panel.querySelector('.chord-label')?.textContent).toBe('Do');
  });

  it('sección sin letra muestra el hint en vez de renderSections', async () => {
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG,
      sections: [{ type: 'verse', label: 'Verso 1', lines: [] }],
    });
    await renderAndOpenPreview();
    const panel = container.querySelector('.section-preview__panel');
    expect(panel.textContent).toContain('Agrega letra para ver la vista previa.');
  });
});
