import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SongEditor importa módulos con efectos de DOM/red; se stubean para poder
// renderizar el editor completo y probar el control de audio por sección
// (mismo patrón que studioPage.test.js para el Estudio).
vi.mock('../src/lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
  refreshData: vi.fn(),
  invalidateSongDetailCache: vi.fn(),
}));
vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok-1' })),
  isFeatureEnabled: vi.fn(() => false),
}));
vi.mock('../src/components/SongView.js', () => ({ renderSongView: vi.fn() }));
vi.mock('../src/lib/stemsApi.js', () => ({
  readAudioDuration: vi.fn().mockResolvedValue(180),
}));
vi.mock('../src/lib/sectionAudioApi.js', () => ({
  fetchSectionAudio: vi.fn(),
  createSectionAudio: vi.fn(),
  uploadSectionAudioFile: vi.fn(),
  deleteSectionAudio: vi.fn(),
}));

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

describe('SongEditor — control de audio por sección', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    store.fetchSongDetail.mockResolvedValue({ ...FAKE_SONG, sections: [...FAKE_SONG.sections] });
    sectionAudioApi.fetchSectionAudio.mockResolvedValue([]);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  async function renderAndOpenAudioPanel() {
    await renderSongEditor(container, 'song-1');
    // Espera a que se resuelva el GET inicial (fetchSectionAudio) y su
    // renderBlocks posterior ANTES de tocar el DOM: si no, ese re-render
    // pisaría los valores de scope/label que fijamos manualmente después.
    await vi.waitFor(() => expect(sectionAudioApi.fetchSectionAudio).toHaveBeenCalled());
    await sectionAudioApi.fetchSectionAudio.mock.results[0].value;
    await Promise.resolve();
    container.querySelector('.section-audio__toggle').click();
  }

  it('renderiza el toggle sin badge cuando la sección no tiene audio', async () => {
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() =>
      expect(sectionAudioApi.fetchSectionAudio).toHaveBeenCalledWith('song-1'),
    );
    await vi.waitFor(() => {
      expect(container.querySelector('.section-audio__toggle')).not.toBeNull();
      expect(container.querySelector('.section-audio__badge')).toBeNull();
    });
  });

  it('renderiza el badge con la cantidad de audios tras el GET', async () => {
    sectionAudioApi.fetchSectionAudio.mockResolvedValue([
      { id: 'a1', sectionIndex: 0, voiceScope: null, label: 'Mezcla original', durationSec: 30 },
    ]);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() =>
      expect(container.querySelector('.section-audio__badge')?.textContent).toBe('1'),
    );
  });

  it('POST + PUT en orden con el archivo y refresca el badge', async () => {
    sectionAudioApi.createSectionAudio.mockResolvedValue({
      uploadUrl: 'https://put/x',
      key: 'song-1/section-0.mp3',
      id: 'a1',
    });
    sectionAudioApi.uploadSectionAudioFile.mockResolvedValue(undefined);

    await renderAndOpenAudioPanel();

    const scopeSelect = container.querySelector('[data-action="audio-scope"]');
    scopeSelect.value = 'soprano';
    const labelInput = container.querySelector('[data-action="audio-label"]');
    labelInput.value = 'Ensayo soprano';

    const fileInput = container.querySelector('[data-action="upload-audio-file"]');
    const file = new File(['contenido'], 'audio.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(sectionAudioApi.createSectionAudio).toHaveBeenCalled());
    expect(sectionAudioApi.createSectionAudio).toHaveBeenCalledWith('song-1', {
      sectionIndex: 0,
      voiceScope: 'soprano',
      label: 'Ensayo soprano',
      durationSec: 180,
    });

    await vi.waitFor(() => expect(sectionAudioApi.uploadSectionAudioFile).toHaveBeenCalled());
    expect(sectionAudioApi.uploadSectionAudioFile).toHaveBeenCalledWith('https://put/x', file);

    // createSectionAudio debe llamarse ANTES que uploadSectionAudioFile.
    const createOrder = sectionAudioApi.createSectionAudio.mock.invocationCallOrder[0];
    const uploadOrder = sectionAudioApi.uploadSectionAudioFile.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(uploadOrder);

    await vi.waitFor(() =>
      expect(container.querySelector('.section-audio__badge')?.textContent).toBe('1'),
    );
  });

  it('rechaza archivos > 25MB sin llamar al API', async () => {
    await renderAndOpenAudioPanel();

    const fileInput = container.querySelector('[data-action="upload-audio-file"]');
    const bigFile = new File(['x'], 'grande.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(bigFile, 'size', { value: 26 * 1024 * 1024 });
    Object.defineProperty(fileInput, 'files', { value: [bigFile] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() =>
      expect(container.querySelector('.section-audio__error')?.textContent).toContain(
        'El archivo supera el límite de 25 MB',
      ),
    );
    expect(sectionAudioApi.createSectionAudio).not.toHaveBeenCalled();
    expect(sectionAudioApi.uploadSectionAudioFile).not.toHaveBeenCalled();
  });

  it('el input de audio solo acepta mp3', async () => {
    await renderAndOpenAudioPanel();
    const fileInput = container.querySelector('[data-action="upload-audio-file"]');
    expect(fileInput.getAttribute('accept')).toBe('audio/mpeg,.mp3');
  });

  it('rechaza archivos que no son mp3 sin llamar al API', async () => {
    await renderAndOpenAudioPanel();

    const fileInput = container.querySelector('[data-action="upload-audio-file"]');
    const wavFile = new File(['x'], 'audio.wav', { type: 'audio/wav' });
    Object.defineProperty(fileInput, 'files', { value: [wavFile] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() =>
      expect(container.querySelector('.section-audio__error')?.textContent).toContain(
        'Solo se admite mp3',
      ),
    );
    expect(sectionAudioApi.createSectionAudio).not.toHaveBeenCalled();
    expect(sectionAudioApi.uploadSectionAudioFile).not.toHaveBeenCalled();
  });

  it('DELETE tras confirmar, quita la fila y actualiza el badge', async () => {
    sectionAudioApi.fetchSectionAudio.mockResolvedValue([
      { id: 'a1', sectionIndex: 0, voiceScope: null, label: null, durationSec: 30 },
    ]);
    sectionAudioApi.deleteSectionAudio.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await renderAndOpenAudioPanel();
    await vi.waitFor(() => expect(container.querySelector('.section-audio__row')).not.toBeNull());

    container.querySelector('[data-action="delete-section-audio"]').click();

    await vi.waitFor(() =>
      expect(sectionAudioApi.deleteSectionAudio).toHaveBeenCalledWith('song-1', 'a1'),
    );
    await vi.waitFor(() => expect(container.querySelector('.section-audio__row')).toBeNull());
    expect(container.querySelector('.section-audio__badge')).toBeNull();
  });

  it('no elimina si se cancela la confirmación', async () => {
    sectionAudioApi.fetchSectionAudio.mockResolvedValue([
      { id: 'a1', sectionIndex: 0, voiceScope: null, label: null, durationSec: 30 },
    ]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await renderAndOpenAudioPanel();
    await vi.waitFor(() => expect(container.querySelector('.section-audio__row')).not.toBeNull());

    container.querySelector('[data-action="delete-section-audio"]').click();

    expect(sectionAudioApi.deleteSectionAudio).not.toHaveBeenCalled();
    expect(container.querySelector('.section-audio__row')).not.toBeNull();
  });

  // ── Compensación si el PUT falla tras el POST ──
  // createSectionAudio (POST) upsertea la fila y devuelve la signed URL ANTES
  // de que uploadSectionAudioFile (PUT) suba el archivo. Si el PUT falla:
  //  - slot nuevo → la fila quedó sin archivo real en storage: hay que borrarla.
  //  - re-subida (slot con audio previo) → la storage_key es la MISMA (ver
  //    api/songs/[id]/section-audio.js), así que el archivo VIEJO sigue intacto;
  //    borrar la fila lo dejaría huérfano — solo hay que re-sincronizar estado.
  describe('compensación tras fallo del PUT', () => {
    it('slot nuevo: borra la fila recién creada y no marca éxito', async () => {
      sectionAudioApi.createSectionAudio.mockResolvedValue({
        uploadUrl: 'https://put/x',
        key: 'song-1/section-0.mp3',
        id: 'a1',
      });
      sectionAudioApi.uploadSectionAudioFile.mockRejectedValue(new Error('red caída'));
      sectionAudioApi.deleteSectionAudio.mockResolvedValue(undefined);

      await renderAndOpenAudioPanel();

      const fileInput = container.querySelector('[data-action="upload-audio-file"]');
      const file = new File(['contenido'], 'audio.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(fileInput, 'files', { value: [file] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      await vi.waitFor(() =>
        expect(sectionAudioApi.deleteSectionAudio).toHaveBeenCalledWith('song-1', 'a1'),
      );
      expect(container.querySelector('.section-audio__badge')).toBeNull();
      expect(container.querySelector('.section-audio__error')?.textContent).toContain('red caída');
    });

    it('re-subida a slot existente: NO borra y re-sincroniza el estado con el servidor', async () => {
      const existing = {
        id: 'a1',
        sectionIndex: 0,
        voiceScope: null,
        label: null,
        durationSec: 30,
      };
      sectionAudioApi.fetchSectionAudio.mockResolvedValue([existing]);
      sectionAudioApi.createSectionAudio.mockResolvedValue({
        uploadUrl: 'https://put/x',
        key: 'song-1/section-0.mp3',
        id: 'a1',
      });
      sectionAudioApi.uploadSectionAudioFile.mockRejectedValue(new Error('red caída'));

      await renderAndOpenAudioPanel();

      // Re-sincronización tras el fallo: el servidor sigue viendo el audio
      // viejo (el PUT nunca sobreescribió el archivo en storage).
      sectionAudioApi.fetchSectionAudio.mockResolvedValueOnce([existing]);

      const fileInput = container.querySelector('[data-action="upload-audio-file"]');
      const file = new File(['contenido'], 'audio.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(fileInput, 'files', { value: [file] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      await vi.waitFor(() =>
        expect(container.querySelector('.section-audio__error')?.textContent).toContain(
          'red caída',
        ),
      );
      expect(sectionAudioApi.deleteSectionAudio).not.toHaveBeenCalled();
      expect(container.querySelector('.section-audio__badge')?.textContent).toBe('1');
    });
  });
});
