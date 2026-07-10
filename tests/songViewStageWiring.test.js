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
  onRouteChange: vi.fn(() => vi.fn()),
}));

vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => null,
  subscribe: () => () => {},
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn((key) => key === 'voz_tono'),
}));

// ImmersiveView mockeado: capturamos el ctx que SongView le pasa a
// enterImmersive para verificar el contrato (FIX 1: pauseAutoscroll, FIX 2:
// setActiveVoice con personId) sin depender del overlay real de la vista.
let capturedCtx = null;
vi.mock('../src/components/ImmersiveView.js', () => ({
  enterImmersive: vi.fn((_el, ctx) => {
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
            groups: (voiceRoster || []).map((v) => ({
              voiceId: v.id,
              start: 0,
              end: 5,
              note: 'B3',
            })),
          },
        ],
      },
    ],
  };
}

describe('SongView → ImmersiveView: contrato de ctx (FIX 1 y FIX 2)', () => {
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

    // El grid de tono-filters se eliminó (T2 hero chips); se verifica el
    // estado interno vía el mismo getter que consume ImmersiveView.
    expect(capturedCtx.getActiveVoice()).toBe('ten2');
  });

  it('setActiveVoice(category, personId) con una sola persona no duplica la selección', async () => {
    const song = buildSong('song-3', [{ id: 'sop1', name: 'Soprano', category: 'soprano' }]);
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-3');
    container.querySelector('#enter-stage-btn').click();

    expect(() => capturedCtx.setActiveVoice('soprano', 'sop1')).not.toThrow();
    // El panel Voz (selector único) se eliminó de este escenario junto con el
    // grid de tono-filters; se verifica el estado interno vía el mismo getter
    // que consume ImmersiveView.
    expect(capturedCtx.getActiveVoice()).toBe('sop1');
  });
});

describe('FINDING 2: SongView resincroniza capas al salir del escenario (ctx.onExit)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    capturedCtx = null;
  });

  it('ctx.onExit refresca aria-pressed y la letra renderizada tras togglear una capa dentro del stage', async () => {
    const { setLayer } = await import('../src/lib/layerStore.js');
    const song = buildSong('song-4', [{ id: 'sop1', name: 'Soprano', category: 'soprano' }]);
    // La canción necesita acordes para que #layer-chords se pinte en la toolbar.
    song.sections[0].lines[0].chords = [{ pos: 0, ch: 'D' }];
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-4');
    container.querySelector('#enter-stage-btn').click();
    expect(capturedCtx.onExit).toBeTypeOf('function');

    // Simula el toggle DENTRO del stage (ImmersiveView llama setLayer directamente).
    setLayer('chords', true);
    capturedCtx.onExit();

    expect(container.querySelector('#layer-chords').getAttribute('aria-pressed')).toBe('true');
    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--chords')).toBe(true);
  });
});

describe('FINDING 4: el afinador flotante se cierra al entrar al escenario', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    capturedCtx = null;
  });

  it('#hero-tuner-mic abierto + entrar al escenario destruye el afinador flotante', async () => {
    const song = buildSong('song-5', [{ id: 'sop1', name: 'Soprano', category: 'soprano' }]);
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-5');

    container.querySelector('#hero-tuner-mic').click();
    expect(document.querySelector('.floating-tuner')).toBeTruthy();
    expect(document.body.classList.contains('floating-tuner-open')).toBe(true);

    container.querySelector('#enter-stage-btn').click();
    expect(document.querySelector('.floating-tuner')).toBeNull();
    expect(document.body.classList.contains('floating-tuner-open')).toBe(false);
  });
});

describe('Task 4: clase body.floating-tuner-open para apilar el FAB de autoscroll', () => {
  afterEach(() => {
    document.body.classList.remove('floating-tuner-open', 'section-player-open');
    document.body.innerHTML = '';
    capturedCtx = null;
  });

  it('se agrega al abrir el afinador con el mic y se quita al re-clickear el mic (toggle)', async () => {
    const song = buildSong('song-6', []);
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-6');

    const mic = container.querySelector('#hero-tuner-mic');
    mic.click();
    expect(document.body.classList.contains('floating-tuner-open')).toBe(true);

    mic.click(); // segundo click en el mismo mic: cierra
    expect(document.body.classList.contains('floating-tuner-open')).toBe(false);
    expect(document.querySelector('.floating-tuner')).toBeNull();
  });

  it('se quita al cerrar con la X del widget', async () => {
    const song = buildSong('song-7', []);
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-7');

    container.querySelector('#hero-tuner-mic').click();
    expect(document.body.classList.contains('floating-tuner-open')).toBe(true);

    document.querySelector('.floating-tuner__close').click();
    expect(document.body.classList.contains('floating-tuner-open')).toBe(false);
  });

  it('se quita al cerrar con Escape', async () => {
    const song = buildSong('song-8', []);
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-8');

    container.querySelector('#hero-tuner-mic').click();
    expect(document.body.classList.contains('floating-tuner-open')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.classList.contains('floating-tuner-open')).toBe(false);
  });
});
