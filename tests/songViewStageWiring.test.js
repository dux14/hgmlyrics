import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub supabase (requires env vars not available in test) — mismo patrón que
// songViewHeroChips.test.js.
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
}));

vi.mock('../src/lib/authStore.js', () => ({
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn((key) => key === 'voz_tono'),
}));

// StageMode mockeado: capturamos el ctx que SongView le pasa a enterStage
// para verificar el contrato (FIX 1: pauseAutoscroll, FIX 2: setActiveVoice
// con personId) sin depender del overlay real del stage.
let capturedCtx = null;
vi.mock('../src/components/StageMode.js', () => ({
  enterStage: vi.fn((_el, ctx) => {
    capturedCtx = ctx;
  }),
}));

const { renderSongView } = await import('../src/components/SongView.js');
const { getSongById } = await import('../src/lib/store.js');

// jsdom no implementa matchMedia ni IntersectionObserver; setupAutoscroll los
// usa para reduced-motion y los presets de velocidad por sección.
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

// isPreview en renderSongView se decide por el TIPO del 2º argumento
// (objeto = preview, string = ruta normal por id): la toolbar con
// #enter-stage-btn solo se pinta fuera de preview, así que hay que pasar un
// songId string y servir la canción vía getSongById (ruta "ya en caché").
function buildSong(id, voiceRoster) {
  return {
    id,
    title: 'Santo',
    schemaVersion: 3,
    voiceRoster,
    sections: [
      {
        type: 'verse',
        label: 'V',
        lines: [
          {
            text: 'Santo es el Señor',
            groups: (voiceRoster || []).map((v) => ({ voiceId: v.id, start: 0, end: 5, note: 'B3' })),
          },
        ],
      },
    ],
  };
}

describe('SongView → StageMode: contrato de ctx (FIX 1 y FIX 2)', () => {
  // setupAutoscroll monta el FAB en document.body (no dentro del container),
  // así que sin limpieza queda un FAB huérfano por test (IDs duplicados).
  afterEach(() => {
    document.body.innerHTML = '';
    capturedCtx = null;
  });

  it('ctx.pauseAutoscroll detiene el autoscroll clásico en curso', async () => {
    const song = buildSong('song-1', []);
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-1');
    container.querySelector('#enter-stage-btn').click();
    expect(capturedCtx).toBeTruthy();

    const toggleBtn = document.querySelector('#autoscroll-toggle');
    toggleBtn.click(); // arranca el autoscroll
    expect(toggleBtn.classList.contains('autoscroll-fab__btn--active')).toBe(true);

    capturedCtx.pauseAutoscroll();
    expect(toggleBtn.classList.contains('autoscroll-fab__btn--active')).toBe(false);
  });

  it('setActiveVoice(category, personId) selecciona la persona concreta con 2+ voces en la categoría', async () => {
    const song = buildSong('song-2', [
      { id: 'ten1', name: 'Tenor 1', category: 'tenor' },
      { id: 'ten2', name: 'Tenor 2', category: 'tenor' },
    ]);
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-2');
    container.querySelector('#enter-stage-btn').click();

    capturedCtx.setActiveVoice('tenor', 'ten2');

    expect(
      container.querySelector('#tono-person-row [data-roster-id="ten2"]').classList.contains('tono-chip--active'),
    ).toBe(true);
  });

  it('setActiveVoice(category, personId) con una sola persona no duplica la selección', async () => {
    const song = buildSong('song-3', [{ id: 'sop1', name: 'Soprano', category: 'soprano' }]);
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-3');
    container.querySelector('#enter-stage-btn').click();

    expect(() => capturedCtx.setActiveVoice('soprano', 'sop1')).not.toThrow();
    expect(container.querySelector('#hero-voice-chips [data-category="soprano"]').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
