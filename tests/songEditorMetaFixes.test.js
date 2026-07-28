import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Task 12: 3 bugs independientes en SongEditor — carrera de links de voces
// (P2-5), guard de audio en secciones nuevas sin guardar (P2-6) y año que no
// se debe inventar al quedar vacío (P2-7). Mismo patrón de mocks que
// songEditorSectionMoves.test.js / songEditorSaveValidation.test.js.
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
  isAdmin: vi.fn(() => false),
}));
vi.mock('../src/lib/sectionAudioApi.js', () => ({
  fetchSectionAudio: vi.fn().mockResolvedValue([]),
  createSectionAudio: vi.fn(),
  uploadSectionAudioFile: vi.fn(),
  deleteSectionAudio: vi.fn(),
}));
vi.mock('../src/lib/stemsApi.js', () => ({ readAudioDuration: vi.fn().mockResolvedValue(180) }));

const store = await import('../src/lib/store.js');
const sectionAudioApi = await import('../src/lib/sectionAudioApi.js');
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
  sections: [{ type: 'verse', label: 'Verso 1', lines: [{ text: 'Primera línea' }] }],
};

describe('SongEditor — Task 12: carrera de links, guard de audio, año no inventado', () => {
  let container;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  // ─── (a) P2-5: carrera de links de voces ───
  describe('carrera del GET de links de voces', () => {
    it('un link agregado por el usuario ANTES de que resuelva el GET sobrevive, y los del servidor se anteponen', async () => {
      let resolveLinksFetch;
      const linksPromise = new Promise((resolve) => {
        resolveLinksFetch = resolve;
      });
      global.fetch = vi.fn((url) => {
        if (url === '/api/songs/song-1/links') return linksPromise;
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      });

      store.fetchSongDetail.mockResolvedValue({ ...FAKE_SONG, sections: [...FAKE_SONG.sections] });
      await renderSongEditor(container, 'song-1');
      await vi.waitFor(() => expect(container.querySelector('#add-voice-link-btn')).not.toBeNull());

      // El usuario agrega un link ANTES de que el GET resuelva.
      container.querySelector('#add-voice-link-btn').click();
      const userUrlInput = container.querySelector('[data-action="vlink-url"][data-idx="0"]');
      userUrlInput.value = 'https://drive.google.com/usuario';
      userUrlInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Ahora resuelve el GET con un link ya guardado en el servidor.
      resolveLinksFetch({
        ok: true,
        json: async () => ({
          platforms: [],
          voices: [
            { voiceType: 'alto', url: 'https://drive.google.com/servidor', label: 'Del server' },
          ],
        }),
      });

      await vi.waitFor(() => {
        const urls = [...container.querySelectorAll('[data-action="vlink-url"]')].map(
          (el) => el.value,
        );
        expect(urls).toHaveLength(2);
      });

      const urls = [...container.querySelectorAll('[data-action="vlink-url"]')].map(
        (el) => el.value,
      );
      // Los del servidor se anteponen; el del usuario sobrevive al final.
      expect(urls).toEqual([
        'https://drive.google.com/servidor',
        'https://drive.google.com/usuario',
      ]);
    });
  });

  // ─── (b) P2-6: guard de audio en secciones nuevas sin guardar ───
  describe('guard de audio en secciones sin guardar (origIndex null)', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    });

    it('subir audio a una sección nueva (origIndex null) muestra error inline y NO llama a createSectionAudio', async () => {
      store.fetchSongDetail.mockResolvedValue({ ...FAKE_SONG, sections: [...FAKE_SONG.sections] });
      await renderSongEditor(container, 'song-1');
      await vi.waitFor(() => expect(container.querySelector('#add-section-btn')).not.toBeNull());
      await vi.waitFor(() => expect(sectionAudioApi.fetchSectionAudio).toHaveBeenCalled());

      // Agrega una sección nueva (origIndex null) y abre su panel de audio.
      container.querySelector('#add-section-btn').click();
      const newSectionAudioToggle = container.querySelector(
        '[data-section-audio="1"] .section-audio__toggle',
      );
      newSectionAudioToggle.click();

      const fileInput = container.querySelector(
        '[data-section-audio="1"] [data-action="upload-audio-file"]',
      );
      const file = new File(['contenido'], 'audio.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(fileInput, 'files', { value: [file] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      await vi.waitFor(() =>
        expect(
          container.querySelector('[data-section-audio="1"] .section-audio__error')?.textContent,
        ).toBe('Guarda la canción para subir audio a esta sección'),
      );
      expect(sectionAudioApi.createSectionAudio).not.toHaveBeenCalled();
    });

    it('subir audio a una sección normal (origIndex 0) usa origIndex como sectionIndex del POST', async () => {
      sectionAudioApi.createSectionAudio.mockResolvedValue({
        uploadUrl: 'https://put/x',
        id: 'a1',
      });
      sectionAudioApi.uploadSectionAudioFile.mockResolvedValue(undefined);
      store.fetchSongDetail.mockResolvedValue({ ...FAKE_SONG, sections: [...FAKE_SONG.sections] });

      await renderSongEditor(container, 'song-1');
      await vi.waitFor(() => expect(sectionAudioApi.fetchSectionAudio).toHaveBeenCalled());
      container.querySelector('[data-section-audio="0"] .section-audio__toggle').click();

      const fileInput = container.querySelector(
        '[data-section-audio="0"] [data-action="upload-audio-file"]',
      );
      const file = new File(['contenido'], 'audio.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(fileInput, 'files', { value: [file] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      await vi.waitFor(() => expect(sectionAudioApi.createSectionAudio).toHaveBeenCalled());
      expect(sectionAudioApi.createSectionAudio).toHaveBeenCalledWith(
        'song-1',
        expect.objectContaining({ sectionIndex: 0 }),
      );
    });
  });

  // ─── (c) P2-7: año no inventado ───
  describe('año no inventado al quedar vacío', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    });

    it('canción existente con year null e input vacío: el payload conserva year null', async () => {
      store.fetchSongDetail.mockResolvedValue({
        ...FAKE_SONG,
        year: null,
        sections: [...FAKE_SONG.sections],
      });
      await renderSongEditor(container, 'song-1');
      await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());
      expect(container.querySelector('#song-year').value).toBe('');

      container.querySelector('#editor-save').click();
      await vi.waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-1', expect.any(Object)),
      );

      const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs/song-1');
      const body = JSON.parse(call[1].body);
      expect(body.year).toBeNull();
    });

    it('canción nueva con input de año vacío: el payload manda year null', async () => {
      await renderSongEditor(container, null);
      await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

      container.querySelector('#song-title').value = 'Canción nueva';
      container.querySelector('#song-title').dispatchEvent(new Event('input', { bubbles: true }));

      container.querySelector('#editor-save').click();
      await vi.waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith('/api/songs', expect.any(Object)),
      );

      const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs');
      const body = JSON.parse(call[1].body);
      expect(body.year).toBeNull();
    });
  });
});
