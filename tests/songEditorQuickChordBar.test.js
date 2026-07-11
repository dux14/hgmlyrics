import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mismo patrón que songEditorSectionAudio.test.js: SongView se mockea entera
// (el editor de acordes/quick-chord-bar no depende del render real; eso lo
// cubre songEditorLivePreview.test.js) para poder montar el editor completo.
vi.mock('../src/lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
  refreshData: vi.fn(),
  invalidateSongDetailCache: vi.fn(),
}));
vi.mock('../src/router.js', () => ({ navigate: vi.fn(), onRouteChange: vi.fn(() => vi.fn()) }));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok-1' })),
  isFeatureEnabled: vi.fn(() => false),
}));
vi.mock('../src/components/SongView.js', () => ({ renderSections: vi.fn(() => '') }));
vi.mock('../src/lib/stemsApi.js', () => ({ readAudioDuration: vi.fn() }));
vi.mock('../src/lib/sectionAudioApi.js', () => ({
  fetchSectionAudio: vi.fn().mockResolvedValue([]),
  createSectionAudio: vi.fn(),
  uploadSectionAudioFile: vi.fn(),
  deleteSectionAudio: vi.fn(),
}));

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
      lines: [
        {
          text: 'Uno',
          chords: [
            { pos: 0, ch: 'C' },
            { pos: 2, ch: 'G' },
          ],
        },
        { text: 'Dos', chords: [{ pos: 0, ch: 'C' }] },
        { text: 'Tres', chords: [] },
      ],
    },
  ],
};

describe('SongEditor — quick-chord-bar en el editor de acordes', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    store.fetchSongDetail.mockResolvedValue({ ...FAKE_SONG, sections: [...FAKE_SONG.sections] });
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.import-modal__overlay').forEach((el) => el.remove());
    vi.clearAllMocks();
  });

  function openChordsFor(lineIndex) {
    const btn = container.querySelectorAll('[data-action="open-chords"]')[lineIndex];
    btn.click();
    return document.querySelector('.import-modal__overlay');
  }

  it('lista los acordes únicos de la canción por frecuencia descendente (C:2, G:1)', async () => {
    await renderSongEditor(container, 'song-1');
    const overlay = openChordsFor(2); // "Tres", sin acordes propios
    const chips = [...overlay.querySelectorAll('.quick-chord-bar__chip')].map((c) => c.textContent);
    expect(chips).toEqual(['C', 'G']);
  });

  it('los chips empiezan deshabilitados (sin rango seleccionado)', async () => {
    await renderSongEditor(container, 'song-1');
    const overlay = openChordsFor(2);
    const chip = overlay.querySelector('.quick-chord-bar__chip');
    expect(chip.disabled).toBe(true);
  });

  it('tap en un char + tap en un chip asigna el acorde (mismo camino que la entrada manual)', async () => {
    await renderSongEditor(container, 'song-1');
    const overlay = openChordsFor(2);

    overlay.querySelector('.char-cell[data-char="0"]').click();
    const chip = [...overlay.querySelectorAll('.quick-chord-bar__chip')].find(
      (c) => c.textContent === 'G',
    );
    expect(chip.disabled).toBe(false);
    chip.click();

    // Se refleja en la lista de acordes de la línea dentro del propio modal.
    const rows = [...overlay.querySelectorAll('.group-row__seg')].map((s) => s.textContent);
    expect(rows).toContain('G');

    overlay.querySelector('[data-chord="done"]').click();
    // El botón de la línea pasa a "activo" (line.chords ahora tiene 1 elemento).
    const btn = container.querySelectorAll('[data-action="open-chords"]')[2];
    expect(btn.classList.contains('line-row__btn--active')).toBe(true);
  });

  it('sin acordes previos en la canción, no renderiza la barra', async () => {
    store.fetchSongDetail.mockResolvedValue({
      ...FAKE_SONG,
      sections: [{ type: 'verse', label: 'Verso 1', lines: [{ text: 'Sola', chords: [] }] }],
    });
    await renderSongEditor(container, 'song-1');
    const overlay = openChordsFor(0);
    expect(overlay.querySelector('.quick-chord-bar')).toBeNull();
  });
});
