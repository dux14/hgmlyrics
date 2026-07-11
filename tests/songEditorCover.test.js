import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mismo patrón de mocks que songEditorSaveValidation.test.js.
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
const { renderSongEditor, coverImageKey } = await import('../src/components/SongEditor.js');

describe('coverImageKey — clave de portada sin colisiones entre álbumes', () => {
  it('mismo álbum → misma key (portada compartida)', () => {
    expect(coverImageKey('Más allá del sol')).toBe(coverImageKey('Más allá del sol'));
  });

  it('álbumes distintos que colisionan en slug ("Álbum Uno" / "Album, Uno!") → keys distintas', () => {
    expect(coverImageKey('Álbum Uno')).not.toBe(coverImageKey('Album, Uno!'));
  });

  it('termina en .webp y empieza con el slug', () => {
    expect(coverImageKey('Hakuna')).toMatch(/^hakuna-[a-z0-9]+\.webp$/);
  });
});

function buildSong(id) {
  return {
    id,
    title: `Canción ${id}`,
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
        lines: [{ text: 'Primera línea', chords: [] }],
      },
    ],
  };
}

describe('SongEditor — la portada elegida no se filtra entre sesiones del editor', () => {
  let container;
  const originalFetch = global.fetch;
  const originalImage = global.Image;
  const originalCreateObjectURL = global.URL.createObjectURL;
  const originalRevokeObjectURL = global.URL.revokeObjectURL;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    localStorage.clear();

    // Stubs mínimos para que handleImageFile (compresión a canvas) corra
    // sincrónicamente en jsdom (que no implementa canvas real).
    class FakeImage {
      set src(_v) {
        this.width = 100;
        this.height = 100;
        this.onload?.();
      }
    }
    global.Image = FakeImage;
    global.URL.createObjectURL = vi.fn(() => 'blob:fake');
    global.URL.revokeObjectURL = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(['fake-cover'], { type: 'image/webp' }));
    };
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    global.fetch = originalFetch;
    global.Image = originalImage;
    global.URL.createObjectURL = originalCreateObjectURL;
    global.URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
  });

  it('no sube la portada de una sesión anterior al guardar una canción distinta sin elegir imagen', async () => {
    // 1. Montar el editor de la canción A y elegir una imagen de portada.
    store.fetchSongDetail.mockResolvedValueOnce(buildSong('song-a'));
    await renderSongEditor(container, 'song-a');
    await vi.waitFor(() => expect(container.querySelector('#cover-input')).not.toBeNull());

    const coverInput = container.querySelector('#cover-input');
    const file = new File(['abc'], 'cover.png', { type: 'image/png' });
    Object.defineProperty(coverInput, 'files', { value: [file], configurable: true });
    coverInput.dispatchEvent(new Event('change'));

    // La preview debe reflejar la imagen elegida (confirma que el blob quedó seteado).
    await vi.waitFor(() =>
      expect(container.querySelector('#image-preview').innerHTML).toMatch(/image-upload__preview/),
    );

    // 2. Montar el editor de la canción B en el mismo contenedor (nueva sesión), sin elegir imagen.
    store.fetchSongDetail.mockResolvedValueOnce(buildSong('song-b'));
    await renderSongEditor(container, 'song-b');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('#editor-save').click();
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-b', expect.any(Object)),
    );

    // La portada de la canción A no debe filtrarse al guardado de B.
    const uploadCalls = global.fetch.mock.calls.filter((c) => c[0] === '/api/upload');
    expect(uploadCalls).toHaveLength(0);
  });

  it('si la subida de portada falla, no guarda la canción y muestra el error', async () => {
    global.fetch = vi.fn((url) => {
      if (url === '/api/upload') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });

    store.fetchSongDetail.mockResolvedValueOnce(buildSong('song-c'));
    await renderSongEditor(container, 'song-c');
    await vi.waitFor(() => expect(container.querySelector('#cover-input')).not.toBeNull());

    const coverInput = container.querySelector('#cover-input');
    const file = new File(['abc'], 'cover.png', { type: 'image/png' });
    Object.defineProperty(coverInput, 'files', { value: [file], configurable: true });
    coverInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() =>
      expect(container.querySelector('#image-preview').innerHTML).toMatch(/image-upload__preview/),
    );

    container.querySelector('#editor-save').click();

    await vi.waitFor(() =>
      expect(container.querySelector('#editor-save-error').hidden).toBe(false),
    );
    expect(container.querySelector('#editor-save-error').textContent).toMatch(
      /No se pudo subir la portada\. Reintenta o quita la imagen\./,
    );

    // Ninguna escritura de canción (PUT/POST a /api/songs/...) debe ocurrir.
    const songWriteCalls = global.fetch.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].startsWith('/api/songs') &&
        ['PUT', 'POST'].includes(c[1]?.method),
    );
    expect(songWriteCalls).toHaveLength(0);
  });
});
