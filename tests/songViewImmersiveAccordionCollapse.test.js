/**
 * songViewImmersiveAccordionCollapse.test.js — Task 1.3: blindaje del full
 * view contra controles del normal view (Fix 2). Al entrar al escenario, el
 * acordeón de audio de sección abierto debe COLAPSARSE y el audio compartido
 * debe quedar PAUSADO — si no, el player de sección sigue sonando/visible
 * detrás del overlay inmersivo. Mismo patrón de mocks que
 * songViewImmersiveWiring.test.js (contrato de ctx) + songView.section-audio.test.js
 * (acordeón de audio por sección).
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
}));

vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn().mockResolvedValue(null),
}));

const fetchSectionAudio = vi.fn();
vi.mock('../src/lib/sectionAudioApi.js', () => ({
  fetchSectionAudio: (...args) => fetchSectionAudio(...args),
}));

// ImmersiveView mockeado: capturamos el ctx (mismo patrón que
// songViewImmersiveWiring.test.js) para invocar ctx.pauseAutoscroll() como lo
// haría el enterImmersive real (línea 1017 de ImmersiveView.js), sin depender
// del overlay completo.
let capturedCtx = null;
vi.mock('../src/components/ImmersiveView.js', () => ({
  enterImmersive: vi.fn((_el, ctx) => {
    capturedCtx = ctx;
  }),
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

describe('Task 1.3: entrar al full view colapsa y pausa el acordeón de audio de sección', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    capturedCtx = null;
    fetchSectionAudio.mockReset();
  });

  it('acordeón abierto + entrar al escenario: panel queda hidden y el audio compartido pausado', async () => {
    const song = buildSong('song-imm-acc-1');
    getSongById.mockReturnValue(song);
    fetchSectionAudio.mockResolvedValue([track({ id: 'a', sectionIndex: 0 })]);
    const container = document.createElement('div');
    await renderSongView(container, 'song-imm-acc-1');
    await vi.waitFor(() => {
      expect(container.querySelector('.section-audio')).toBeTruthy();
    });

    // Abre el acordeón y arranca el audio compartido.
    container.querySelector('.lyrics__section-play').click();
    const panel = container.querySelector('.section-audio');
    expect(panel.hidden).toBe(false);
    container.querySelector('.section-audio__play').click();
    const audioEl = container.querySelector('audio');
    expect(audioEl.pause).not.toHaveBeenCalled();

    // Entra al escenario: dispara el mismo callback que ImmersiveView real
    // invoca de forma síncrona al entrar (ctx.pauseAutoscroll).
    container.querySelector('#enter-stage-btn').click();
    expect(capturedCtx).toBeTruthy();
    capturedCtx.pauseAutoscroll();

    expect(audioEl.pause).toHaveBeenCalled();
    expect(panel.hidden).toBe(true);
    // El botón de sección refleja el colapso (aria-label a "Mostrar…").
    const playBtn = container.querySelector('.lyrics__section-play');
    expect(playBtn.getAttribute('aria-label')).toBe('Mostrar audio de la sección');
  });
});
