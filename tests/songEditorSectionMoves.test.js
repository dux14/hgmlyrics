import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Task 11: el audio por sección sigue a su sección al mover/borrar.
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
  isAdmin: vi.fn(() => false),
}));
vi.mock('../src/lib/sectionAudioApi.js', () => ({
  fetchSectionAudio: vi.fn().mockResolvedValue([]),
  createSectionAudio: vi.fn(),
  uploadSectionAudioFile: vi.fn(),
  deleteSectionAudio: vi.fn(),
}));
vi.mock('../src/lib/stemsApi.js', () => ({ readAudioDuration: vi.fn() }));
vi.mock('../src/components/ConfirmDialog.js', () => ({ confirmDialog: vi.fn() }));

const store = await import('../src/lib/store.js');
const sectionAudioApi = await import('../src/lib/sectionAudioApi.js');
const { confirmDialog } = await import('../src/components/ConfirmDialog.js');
const { renderSongEditor } = await import('../src/components/SongEditor.js');

const FAKE_SONG_2_SECTIONS = {
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
    { type: 'verse', label: 'Verso 1', lines: [{ text: 'Primera línea' }] },
    { type: 'chorus', label: 'Coro', lines: [{ text: 'Segunda línea' }] },
  ],
};

const FAKE_SONG_3_SECTIONS = {
  ...FAKE_SONG_2_SECTIONS,
  sections: [
    { type: 'verse', label: 'Verso 1', lines: [{ text: 'Primera línea' }] },
    { type: 'chorus', label: 'Coro', lines: [{ text: 'Segunda línea' }] },
    { type: 'verse', label: 'Verso 2', lines: [{ text: 'Tercera línea' }] },
  ],
};

describe('SongEditor — audio por sección sigue a su sección al mover/borrar', () => {
  let container;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('mover la sección 0 abajo: el payload incluye sectionAudioMoves {from,to} para ambas', async () => {
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_2_SECTIONS,
      sections: FAKE_SONG_2_SECTIONS.sections.map((s) => ({ ...s })),
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('[data-action="move-section-down"][data-section="0"]').click();

    container.querySelector('#editor-save').click();
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-1', expect.any(Object)),
    );

    const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs/song-1');
    const body = JSON.parse(call[1].body);
    expect(body.sectionAudioMoves).toEqual(
      expect.arrayContaining([
        { from: 0, to: 1 },
        { from: 1, to: 0 },
      ]),
    );
    expect(body.sectionAudioMoves).toHaveLength(2);
  });

  it('sección nueva (add-section-btn, origIndex null) no genera move', async () => {
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_2_SECTIONS,
      sections: FAKE_SONG_2_SECTIONS.sections.map((s) => ({ ...s })),
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('#add-section-btn').click();

    container.querySelector('#editor-save').click();
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-1', expect.any(Object)),
    );

    const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs/song-1');
    const body = JSON.parse(call[1].body);
    // Las 2 secciones existentes no se movieron (siguen en su posición 0/1); la
    // nueva sección (origIndex null) al final tampoco genera move.
    expect(body.sectionAudioMoves).toBeUndefined();
  });

  it('sin ningún cambio de orden, no manda sectionAudioMoves', async () => {
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_2_SECTIONS,
      sections: FAKE_SONG_2_SECTIONS.sections.map((s) => ({ ...s })),
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('#editor-save').click();
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-1', expect.any(Object)),
    );

    const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs/song-1');
    const body = JSON.parse(call[1].body);
    expect(body.sectionAudioMoves).toBeUndefined();
  });

  // Bug crítico reproducido: 3 secciones, se borra la del medio (sin audio,
  // confirmDialog propio) -> bloques finales quedan con origIndex [0, 2] -> el
  // move resultante es {from:2,to:1}. `from` referencia el layout VIEJO (3
  // secciones) y NO debe acotarse contra el layout nuevo (2): el back debe
  // aceptarlo y el guardado debe completar sin 400.
  it('borrar la sección del medio (sin audio): el payload lleva {from:2,to:1} y el guardado completa', async () => {
    confirmDialog.mockResolvedValue(true);
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_3_SECTIONS,
      sections: FAKE_SONG_3_SECTIONS.sections.map((s) => ({ ...s })),
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('[data-action="delete-section"][data-section="1"]').click();
    await vi.waitFor(() => {
      const labels = Array.from(container.querySelectorAll('.section-block__label-input')).map(
        (el) => el.value,
      );
      expect(labels).not.toContain('Coro');
    });

    container.querySelector('#editor-save').click();
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-1', expect.any(Object)),
    );

    const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs/song-1');
    const body = JSON.parse(call[1].body);
    expect(body.sectionAudioMoves).toEqual([{ from: 2, to: 1 }]);
    // El mock del fetch resuelve { ok: true } -> el guardado completa sin error.
    const errorEl = container.querySelector('#editor-save-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.hidden).toBe(true);
  });

  describe('delete-section con audio', () => {
    beforeEach(() => {
      sectionAudioApi.fetchSectionAudio.mockResolvedValue([
        { id: 'a1', sectionIndex: 0, voiceScope: null, label: 'Mezcla', durationSec: 30 },
      ]);
    });

    it('pide confirmDialog y borra los audios ANTES de quitar el bloque', async () => {
      confirmDialog.mockResolvedValue(true);
      sectionAudioApi.deleteSectionAudio.mockResolvedValue(undefined);
      store.fetchSongDetail.mockResolvedValue({
        ...FAKE_SONG_2_SECTIONS,
        sections: FAKE_SONG_2_SECTIONS.sections.map((s) => ({ ...s })),
      });
      await renderSongEditor(container, 'song-1');
      await vi.waitFor(() => expect(sectionAudioApi.fetchSectionAudio).toHaveBeenCalled());
      await sectionAudioApi.fetchSectionAudio.mock.results[0].value;
      await Promise.resolve();

      container.querySelector('[data-action="delete-section"][data-section="0"]').click();

      await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Eliminar sección', danger: true }),
      );
      await vi.waitFor(() =>
        expect(sectionAudioApi.deleteSectionAudio).toHaveBeenCalledWith('song-1', 'a1'),
      );

      await vi.waitFor(() => {
        const labels = Array.from(container.querySelectorAll('.section-block__label-input')).map(
          (el) => el.value,
        );
        expect(labels).not.toContain('Verso 1');
      });
    });

    it('si el diálogo devuelve false, no borra nada y conserva el bloque', async () => {
      confirmDialog.mockResolvedValue(false);
      store.fetchSongDetail.mockResolvedValue({
        ...FAKE_SONG_2_SECTIONS,
        sections: FAKE_SONG_2_SECTIONS.sections.map((s) => ({ ...s })),
      });
      await renderSongEditor(container, 'song-1');
      await vi.waitFor(() => expect(sectionAudioApi.fetchSectionAudio).toHaveBeenCalled());
      await sectionAudioApi.fetchSectionAudio.mock.results[0].value;
      await Promise.resolve();

      container.querySelector('[data-action="delete-section"][data-section="0"]').click();

      await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
      expect(sectionAudioApi.deleteSectionAudio).not.toHaveBeenCalled();
      const labels = Array.from(container.querySelectorAll('.section-block__label-input')).map(
        (el) => el.value,
      );
      expect(labels).toContain('Verso 1');
    });

    it('con 2 audios, si el 2do delete falla: toast de error, el bloque NO se quita, se llama 2 veces', async () => {
      sectionAudioApi.fetchSectionAudio.mockResolvedValue([
        { id: 'a1', sectionIndex: 0, voiceScope: null, label: 'Mezcla', durationSec: 30 },
        { id: 'a2', sectionIndex: 0, voiceScope: 'soprano', label: 'Soprano', durationSec: 25 },
      ]);
      confirmDialog.mockResolvedValue(true);
      sectionAudioApi.deleteSectionAudio.mockImplementation(async (_songId, id) => {
        if (id === 'a2') throw new Error('red caída');
      });
      store.fetchSongDetail.mockResolvedValue({
        ...FAKE_SONG_2_SECTIONS,
        sections: FAKE_SONG_2_SECTIONS.sections.map((s) => ({ ...s })),
      });
      await renderSongEditor(container, 'song-1');
      await vi.waitFor(() => expect(sectionAudioApi.fetchSectionAudio).toHaveBeenCalled());
      await sectionAudioApi.fetchSectionAudio.mock.results[0].value;
      await Promise.resolve();

      container.querySelector('[data-action="delete-section"][data-section="0"]').click();

      await vi.waitFor(() => expect(sectionAudioApi.deleteSectionAudio).toHaveBeenCalledTimes(2));
      expect(sectionAudioApi.deleteSectionAudio).toHaveBeenNthCalledWith(1, 'song-1', 'a1');
      expect(sectionAudioApi.deleteSectionAudio).toHaveBeenNthCalledWith(2, 'song-1', 'a2');

      await vi.waitFor(() => {
        const toast = document.querySelector('.toast');
        expect(toast?.textContent).toMatch(/red caída/);
        expect(toast?.classList.contains('toast--error')).toBe(true);
      });

      // El bloque se conserva: el fallo parcial no debe quitar la sección.
      const labels = Array.from(container.querySelectorAll('.section-block__label-input')).map(
        (el) => el.value,
      );
      expect(labels).toContain('Verso 1');
    });
  });
});
