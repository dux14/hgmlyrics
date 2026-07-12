/**
 * songView.section-audio.test.js — Task 1.2: acordeón de audio por sección
 * montado en SongView, en reemplazo del widget global .section-player.
 * Mismo patrón que songViewImmersiveWiring.test.js (mocks de supabase/store/
 * router/authStore + jsdom stubs de matchMedia/IntersectionObserver).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

vi.mock('../src/lib/store.js', () => ({
  getSongById: vi.fn(),
  filterByAlbum: vi.fn(),
  fetchSongDetail: vi.fn(),
  getAdjacentSongs: vi.fn().mockReturnValue({ prev: null, next: null }),
}));

vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
  onRouteChange: vi.fn(() => vi.fn()),
}));

vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => null,
  subscribe: () => () => {},
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn().mockResolvedValue(null),
}));

const fetchSectionAudio = vi.fn();
vi.mock('../src/lib/sectionAudioApi.js', () => ({
  fetchSectionAudio: (...args) => fetchSectionAudio(...args),
}));

const { renderSongView } = await import('../src/components/SongView.js');
const { getSongById } = await import('../src/lib/store.js');

window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

globalThis.IntersectionObserver =
  globalThis.IntersectionObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

function buildSong(id) {
  return {
    id,
    title: 'Santo',
    schemaVersion: 3,
    voiceRoster: [],
    sections: [
      { type: 'verse', label: 'Verso 1', lines: [{ text: 'Santo es el Señor' }] },
      { type: 'chorus', label: 'Coro', lines: [{ text: 'Aleluya' }] },
    ],
  };
}

function track(overrides = {}) {
  return {
    id: 'id-0',
    sectionIndex: 0,
    voiceScope: null,
    label: null,
    durationSec: 10,
    url: 'https://storage.example.com/song/section-0.mp3',
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

describe('SongView + acordeón de audio por sección (Task 1.2)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    fetchSectionAudio.mockReset();
  });

  it('cada encabezado de sección CON tracks recibe un panel .section-audio colapsado tras él', async () => {
    const song = buildSong('song-acc-1');
    getSongById.mockReturnValue(song);
    fetchSectionAudio.mockResolvedValue([track({ id: 'a', sectionIndex: 0 })]);
    const container = document.createElement('div');
    await renderSongView(container, 'song-acc-1');

    await vi.waitFor(() => {
      expect(container.querySelector('.section-audio')).toBeTruthy();
    });

    const sections = container.querySelectorAll('#lyrics-content .lyrics__section');
    const [verse, chorus] = sections;
    expect(verse.querySelector('.lyrics__section-label + .section-audio')).toBeTruthy();
    expect(chorus.querySelector('.section-audio')).toBeNull();
  });

  it('.lyrics__section-play togglea hidden de SU panel y colapsa el resto (uno abierto a la vez)', async () => {
    const song = buildSong('song-acc-2');
    getSongById.mockReturnValue(song);
    fetchSectionAudio.mockResolvedValue([
      track({ id: 'a', sectionIndex: 0, url: 'https://x/0.mp3' }),
      track({ id: 'b', sectionIndex: 1, url: 'https://x/1.mp3' }),
    ]);
    const container = document.createElement('div');
    await renderSongView(container, 'song-acc-2');
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.section-audio').length).toBe(2);
    });

    const playButtons = container.querySelectorAll('.lyrics__section-play');
    const panels = container.querySelectorAll('.section-audio');
    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(true);

    playButtons[0].click();
    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);

    playButtons[1].click();
    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(false);

    // Re-clic en el mismo botón cierra su panel (toggle).
    playButtons[1].click();
    expect(panels[1].hidden).toBe(true);
  });

  it('al expandir por primera vez carga metadata del track (manager.load con preload metadata)', async () => {
    const song = buildSong('song-acc-3');
    getSongById.mockReturnValue(song);
    fetchSectionAudio.mockResolvedValue([
      track({ id: 'a', sectionIndex: 0, url: 'https://x/0.mp3' }),
    ]);
    const container = document.createElement('div');
    await renderSongView(container, 'song-acc-3');
    await vi.waitFor(() => {
      expect(container.querySelector('.section-audio')).toBeTruthy();
    });

    const audioEl = container.querySelector('audio');
    expect(audioEl).toBeTruthy();
    expect(audioEl.src).toBe('');

    container.querySelector('.lyrics__section-play').click();

    expect(audioEl.src).toBe('https://x/0.mp3');
    expect(audioEl.preload).toBe('metadata');
    expect(audioEl.play).not.toHaveBeenCalled();
  });

  it('no existe .section-player global ni body.section-player-open', async () => {
    const song = buildSong('song-acc-4');
    getSongById.mockReturnValue(song);
    fetchSectionAudio.mockResolvedValue([
      track({ id: 'a', sectionIndex: 0, url: 'https://x/0.mp3' }),
    ]);
    const container = document.createElement('div');
    await renderSongView(container, 'song-acc-4');
    await vi.waitFor(() => {
      expect(container.querySelector('.section-audio')).toBeTruthy();
    });

    expect(container.querySelector('.section-player')).toBeNull();
    expect(document.querySelector('.section-player')).toBeNull();
    expect(document.body.classList.contains('section-player-open')).toBe(false);
  });

  // Regresión (code review Task 1.2): wireSectionPlayButtons destruye y
  // recrea TODOS los acordeones en cada reRenderLyrics (transponer, cambiar
  // notación, elegir voz…), y cada acordeón nuevo reiniciaba su chip a
  // "Mezcla" perdiendo el scope realmente sonando. reRenderLyrics se dispara
  // aquí vía el toggle de notación del sheet de opciones (ajeno al audio).
  it('un reRenderLyrics ajeno (cambio de notación) no resetea el scope de voz que suena en el acordeón', async () => {
    const song = buildSong('song-acc-6');
    getSongById.mockReturnValue(song);
    fetchSectionAudio.mockResolvedValue([
      track({ id: 'mix', sectionIndex: 0, voiceScope: null, url: 'https://x/mix.mp3' }),
      track({ id: 'tenor', sectionIndex: 0, voiceScope: 'tenor', url: 'https://x/tenor.mp3' }),
    ]);
    const container = document.createElement('div');
    await renderSongView(container, 'song-acc-6');
    await vi.waitFor(() => {
      expect(container.querySelector('.section-audio')).toBeTruthy();
    });

    // Abre el panel, cambia a la voz tenor y reproduce.
    container.querySelector('.lyrics__section-play').click();
    container.querySelectorAll('.section-audio__chip')[1].click();
    container.querySelector('.section-audio__play').click();

    const audioEl = container.querySelector('audio');
    expect(audioEl.src).toBe('https://x/tenor.mp3');

    // Dispara un reRenderLyrics ajeno al audio (cambio de notación desde el
    // sheet de opciones) — antes del fix, esto reconstruía el acordeón con
    // el chip por defecto (mezcla) mientras tenor seguía sonando de fondo.
    container.querySelector('#open-options-sheet').click();
    document.querySelector('[data-notation="latin"]').click();

    const chipsAfter = container.querySelectorAll('.section-audio__chip');
    expect(chipsAfter[1].getAttribute('aria-pressed')).toBe('true'); // sigue en tenor
    expect(chipsAfter[0].getAttribute('aria-pressed')).toBe('false'); // no mezcla
    expect(container.querySelector('audio').src).toBe('https://x/tenor.mp3');
  });

  it('canción sin tracks no monta ningún .section-audio', async () => {
    const song = buildSong('song-acc-5');
    getSongById.mockReturnValue(song);
    fetchSectionAudio.mockResolvedValue([]);
    const container = document.createElement('div');
    await renderSongView(container, 'song-acc-5');
    await vi.waitFor(() => {
      expect(fetchSectionAudio).toHaveBeenCalled();
    });

    expect(container.querySelector('.section-audio')).toBeNull();
  });
});
