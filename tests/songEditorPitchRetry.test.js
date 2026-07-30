import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mismo patrón de montaje que songEditorSectionAudio.test.js: SongEditor
// importa módulos con efectos de red/DOM, así que se stubean para poder
// renderizar el editor real y ejercitar el handler de 'open-tono'.
vi.mock('../src/lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
  refreshData: vi.fn(),
  invalidateSongDetailCache: vi.fn(),
}));
vi.mock('../src/router.js', () => ({ navigate: vi.fn(), onRouteChange: vi.fn(() => vi.fn()) }));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok-1' })),
}));
vi.mock('../src/components/SongView.js', () => ({ renderSongView: vi.fn() }));
vi.mock('../src/lib/sectionAudioApi.js', () => ({
  fetchSectionAudio: vi.fn().mockResolvedValue([]),
  createSectionAudio: vi.fn(),
  uploadSectionAudioFile: vi.fn(),
  deleteSectionAudio: vi.fn(),
}));
vi.mock('../src/lib/pitchNotesApi.js', () => ({
  getSongPitchNotes: vi.fn(),
}));
vi.mock('../src/components/editor/TonoEditorModal.js', () => ({
  openTonoEditorModal: vi.fn(),
}));

const store = await import('../src/lib/store.js');
const { getSongPitchNotes } = await import('../src/lib/pitchNotesApi.js');
const { openTonoEditorModal } = await import('../src/components/editor/TonoEditorModal.js');
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

describe('SongEditor — reintento del pedido de tono tras un fallo', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    store.fetchSongDetail.mockResolvedValue({ ...FAKE_SONG, sections: [...FAKE_SONG.sections] });
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('vuelve a pedir las notas de tono si la primera vez el pedido falló', async () => {
    const primerError = new Error('caída de red');
    getSongPitchNotes.mockRejectedValueOnce(primerError);
    getSongPitchNotes.mockResolvedValueOnce({ notes: [] });

    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('.line-row__btn--tono')).not.toBeNull());

    const tonoBtn = container.querySelector('.line-row__btn--tono');

    // Primera apertura: dispara el pedido, que va a rechazar.
    tonoBtn.click();
    await vi.waitFor(() => expect(getSongPitchNotes).toHaveBeenCalledTimes(1));
    expect(openTonoEditorModal).toHaveBeenCalledTimes(1);

    const primeraPromesa = openTonoEditorModal.mock.calls[0][1].pitchNotesPromise;
    // Debe ser la promesa ORIGINAL rechazada, no null/undefined: el `.catch`
    // interno del handler puede haber limpiado la variable de closure antes
    // de que el modal reciba el argumento, pero el modal necesita la
    // promesa real (con el rechazo) para mostrar el motivo del error.
    expect(primeraPromesa).toBeInstanceOf(Promise);
    await expect(primeraPromesa).rejects.toBe(primerError);

    // Espera a que el `.catch` interno del handler resetee la variable de
    // closure a null antes de la segunda apertura.
    await vi.waitFor(() => {});

    // Segunda apertura: sin el fix, `pitchNotesPromise` seguiría cacheada
    // (rechazada) y `getSongPitchNotes` NO se volvería a llamar.
    tonoBtn.click();
    await vi.waitFor(() => expect(getSongPitchNotes).toHaveBeenCalledTimes(2));
    expect(openTonoEditorModal).toHaveBeenCalledTimes(2);

    const segundaPromesa = openTonoEditorModal.mock.calls[1][1].pitchNotesPromise;
    expect(segundaPromesa).not.toBe(primeraPromesa);
    await expect(segundaPromesa).resolves.toEqual({ notes: [] });
  });
});
