import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Task 14 (C4 + C5): guard de cambios sin guardar en Cancelar + migración de
// los confirm() nativos restantes (delete-section sin audio, delete-section-
// audio, eliminar canción) a confirmDialog. Mismo patrón de mocks que
// songEditorSectionMoves.test.js.
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
vi.mock('../src/components/ConfirmDialog.js', () => ({ confirmDialog: vi.fn() }));
// El modal real monta en document.body; para probar el guard de dirty solo
// necesitamos simular su contrato (muta `line.chords` y llama `onClose`).
vi.mock('../src/components/editor/ChordEditorModal.js', () => ({
  openChordEditorModal: vi.fn(),
}));

const store = await import('../src/lib/store.js');
const { navigate } = await import('../src/router.js');
const { confirmDialog } = await import('../src/components/ConfirmDialog.js');
const { openChordEditorModal } = await import('../src/components/editor/ChordEditorModal.js');
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
    { type: 'verse', label: 'Verso 1', lines: [{ text: 'Primera línea' }] },
    { type: 'chorus', label: 'Coro', lines: [{ text: 'Segunda línea' }] },
  ],
};

describe('SongEditor — guard de cambios sin guardar (Cancelar)', () => {
  let container;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG,
      sections: FAKE_SONG.sections.map((s) => ({ ...s })),
    });
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('cancelar sin cambios navega directo sin pedir confirmación', async () => {
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-cancel')).not.toBeNull());

    container.querySelector('#editor-cancel').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it('editar una línea marca dirty: cancelar pide confirmDialog y respeta la cancelación', async () => {
    confirmDialog.mockResolvedValue(false);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-cancel')).not.toBeNull());

    const lineInput = container.querySelector('[data-action="edit-text"]');
    lineInput.value = 'Línea editada';
    lineInput.dispatchEvent(new Event('input', { bubbles: true }));

    container.querySelector('#editor-cancel').click();
    await vi.waitFor(() =>
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Descartar cambios', danger: true }),
      ),
    );

    expect(navigate).not.toHaveBeenCalled();
  });

  it('editar una línea + cancelar + confirmar descarte: navega', async () => {
    confirmDialog.mockResolvedValue(true);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-cancel')).not.toBeNull());

    const lineInput = container.querySelector('[data-action="edit-text"]');
    lineInput.value = 'Línea editada';
    lineInput.dispatchEvent(new Event('input', { bubbles: true }));

    container.querySelector('#editor-cancel').click();
    await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
  });
});

describe('SongEditor — delete-section sin audio usa confirmDialog (no window.confirm)', () => {
  let container;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG,
      sections: FAKE_SONG.sections.map((s) => ({ ...s })),
    });
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('usa confirmDialog (window.confirm no se llama) y borra la sección al confirmar', async () => {
    const nativeConfirmSpy = vi.spyOn(window, 'confirm');
    confirmDialog.mockResolvedValue(true);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('[data-action="delete-section"][data-section="0"]').click();

    await vi.waitFor(() =>
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Eliminar sección', danger: true }),
      ),
    );
    expect(nativeConfirmSpy).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      const labels = Array.from(container.querySelectorAll('.section-block__label-input')).map(
        (el) => el.value,
      );
      expect(labels).not.toContain('Verso 1');
    });
  });

  it('si se cancela el diálogo, conserva la sección', async () => {
    confirmDialog.mockResolvedValue(false);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('[data-action="delete-section"][data-section="0"]').click();

    await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    const labels = Array.from(container.querySelectorAll('.section-block__label-input')).map(
      (el) => el.value,
    );
    expect(labels).toContain('Verso 1');
  });
});

describe('SongEditor — eliminar canción usa confirmDialog', () => {
  let container;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG,
      sections: FAKE_SONG.sections.map((s) => ({ ...s })),
    });
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('pide confirmDialog con el título de la canción y elimina al confirmar', async () => {
    confirmDialog.mockResolvedValue(true);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-delete')).not.toBeNull());

    container.querySelector('#editor-delete').click();

    await vi.waitFor(() =>
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Eliminar canción', danger: true }),
      ),
    );
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/songs/song-1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('si se cancela el diálogo, no elimina', async () => {
    confirmDialog.mockResolvedValue(false);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-delete')).not.toBeNull());

    container.querySelector('#editor-delete').click();

    await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/songs/song-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('SongEditor — el guard de dirty ignora acciones canceladas', () => {
  let container;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG,
      sections: FAKE_SONG.sections.map((s) => ({ ...s })),
    });
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('delete-section cancelado + Cancelar del editor: navega directo sin diálogo de descarte', async () => {
    // Primera llamada a confirmDialog es la de "Eliminar sección" (cancelada);
    // si sobreviniera una segunda por "Descartar cambios" sería el bug.
    confirmDialog.mockResolvedValue(false);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('[data-action="delete-section"][data-section="0"]').click();
    await vi.waitFor(() =>
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Eliminar sección' }),
      ),
    );

    container.querySelector('#editor-cancel').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    // Solo se llamó confirmDialog una vez (la de eliminar sección); no hubo
    // un segundo diálogo de "Descartar cambios".
    expect(confirmDialog).toHaveBeenCalledTimes(1);
  });
});

describe('SongEditor — modal de acordes marca dirty solo si hubo cambio real', () => {
  let container;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG,
      sections: FAKE_SONG.sections.map((s) => ({ ...s })),
    });
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('abrir y cerrar el modal SIN mutar chords: Cancelar navega directo', async () => {
    openChordEditorModal.mockImplementation((line, { onClose }) => onClose());
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-cancel')).not.toBeNull());

    container.querySelector('[data-action="open-chords"]').click();
    expect(openChordEditorModal).toHaveBeenCalled();

    container.querySelector('#editor-cancel').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it('abrir el modal, mutar chords y cerrar: Cancelar pide confirmación', async () => {
    openChordEditorModal.mockImplementation((line, { onClose }) => {
      line.chords = [...(line.chords || []), { pos: 0, ch: 'C' }];
      onClose();
    });
    confirmDialog.mockResolvedValue(false);
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-cancel')).not.toBeNull());

    container.querySelector('[data-action="open-chords"]').click();
    expect(openChordEditorModal).toHaveBeenCalled();

    container.querySelector('#editor-cancel').click();
    await vi.waitFor(() =>
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Descartar cambios' }),
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
