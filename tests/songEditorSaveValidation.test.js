import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mismo patrón que songEditorLivePreview.test.js: SongView.js real (renderSections
// se usa para la preview), stubs solo en dependencias con efectos de red/DOM.
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
const { isFeatureEnabled } = await import('../src/lib/authStore.js');
const { renderSongEditor } = await import('../src/components/SongEditor.js');

// Chord con pos fuera del texto ("Primera línea" tiene 13 caracteres): la
// validación pre-guardado debe bloquear el PUT antes de llamar fetch.
const FAKE_SONG_BAD_CHORD = {
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
      lines: [{ text: 'Primera línea', chords: [{ pos: 99, ch: 'C' }] }],
    },
  ],
};

// Línea con texto vacío pero con una voz asignada (groups): blocksToSectionsV3
// ya no la descarta en silencio (ver songEditorV3.test.js), así que la
// validación pre-guardado debe bloquear el PUT con un error legible en vez de
// dejar pasar una asignación que no coincide con ningún texto.
const FAKE_SONG_EMPTY_LINE_WITH_GROUP = {
  ...FAKE_SONG_BAD_CHORD,
  sections: [
    {
      type: 'verse',
      label: 'Verso 1',
      lines: [{ text: '', groups: [{ start: 0, end: 2, voiceId: 'sop1' }] }],
    },
  ],
};

const FAKE_SONG_OK = {
  ...FAKE_SONG_BAD_CHORD,
  sections: [
    {
      type: 'verse',
      label: 'Verso 1',
      lines: [{ text: 'Primera línea', chords: [{ pos: 0, ch: 'C' }] }],
    },
  ],
};

// Canción con tono ya asignado (voiceRoster + groups en una línea): el flag
// voz_tono apagado NO debe impedir guardar un typo aquí, porque el roster de
// datos siempre round-tripea aunque la UI de edición de tono esté oculta.
const FAKE_SONG_WITH_TONO = {
  ...FAKE_SONG_BAD_CHORD,
  schemaVersion: 3,
  voiceRoster: [{ id: 'sop1', name: 'Soprano', category: 'soprano', referenceKey: null }],
  sections: [
    {
      type: 'verse',
      label: 'Verso 1',
      lines: [
        {
          text: 'Primera línea',
          chords: [{ pos: 0, ch: 'C' }],
          groups: [{ start: 0, end: 4, voiceId: 'sop1' }],
        },
      ],
    },
  ],
};

describe('SongEditor — validación pre-guardado', () => {
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

  it('bloquea el guardado con un mensaje legible y no llama fetch cuando hay un acorde fuera del texto', async () => {
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_BAD_CHORD,
      sections: [...FAKE_SONG_BAD_CHORD.sections],
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('#editor-save').click();
    await vi.waitFor(() => {
      const err = container.querySelector('#editor-save-error');
      expect(err.hidden).toBe(false);
    });

    const errorText = container.querySelector('#editor-save-error').textContent;
    expect(errorText).toMatch(/Verso 1, línea 1/);
    expect(errorText).toMatch(/fuera del texto/);
    // No debe haber llamado a /api/songs/song-1 (ni ningún fetch de guardado).
    const songCalls = global.fetch.mock.calls.filter((c) => c[0] === '/api/songs/song-1');
    expect(songCalls).toHaveLength(0);
  });

  it('bloquea el guardado con un mensaje legible cuando una línea vacía tiene una voz asignada', async () => {
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_EMPTY_LINE_WITH_GROUP,
      sections: [...FAKE_SONG_EMPTY_LINE_WITH_GROUP.sections],
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('#editor-save').click();
    await vi.waitFor(() => {
      const err = container.querySelector('#editor-save-error');
      expect(err.hidden).toBe(false);
    });

    const errorText = container.querySelector('#editor-save-error').textContent;
    expect(errorText).toMatch(/Verso 1, línea 1/);
    expect(errorText).toMatch(/asignación de voz/);
    // No debe haber llamado a /api/songs/song-1 (ni ningún fetch de guardado).
    const songCalls = global.fetch.mock.calls.filter((c) => c[0] === '/api/songs/song-1');
    expect(songCalls).toHaveLength(0);
  });

  it('con un payload válido, guarda con un único fetch (canción + links juntos)', async () => {
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_OK,
      sections: [...FAKE_SONG_OK.sections],
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('#editor-save').click();
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-1', expect.any(Object)),
    );

    const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs/song-1');
    const body = JSON.parse(call[1].body);
    expect(body).toHaveProperty('platformLinks');
    expect(body).toHaveProperty('voiceLinks');
    // Un solo request de guardado: no hay una 2ª llamada PUT a /links (el GET
    // inicial para precargar el formulario sí ocurre, y no cuenta).
    const linksPutCalls = global.fetch.mock.calls.filter(
      (c) => c[0] === '/api/songs/song-1/links' && c[1]?.method === 'PUT',
    );
    expect(linksPutCalls).toHaveLength(0);
  });

  it('con el flag voz_tono apagado, guarda una canción con tono ya asignado (roster+groups round-tripean)', async () => {
    isFeatureEnabled.mockReturnValue(false);
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_WITH_TONO,
      sections: [...FAKE_SONG_WITH_TONO.sections],
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('#editor-save').click();
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-1', expect.any(Object)),
    );

    const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs/song-1');
    const body = JSON.parse(call[1].body);
    expect(body.schemaVersion).toBe(3);
    expect(body.voiceRoster).toEqual(FAKE_SONG_WITH_TONO.voiceRoster);
  });

  it('con el flag voz_tono encendido, el guardado se comporta igual (regresión)', async () => {
    isFeatureEnabled.mockReturnValue(true);
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG_WITH_TONO,
      sections: [...FAKE_SONG_WITH_TONO.sections],
    });
    await renderSongEditor(container, 'song-1');
    await vi.waitFor(() => expect(container.querySelector('#editor-save')).not.toBeNull());

    container.querySelector('#editor-save').click();
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/songs/song-1', expect.any(Object)),
    );

    const call = global.fetch.mock.calls.find((c) => c[0] === '/api/songs/song-1');
    const body = JSON.parse(call[1].body);
    expect(body.schemaVersion).toBe(3);
    expect(body.voiceRoster).toEqual(FAKE_SONG_WITH_TONO.voiceRoster);
  });
});
