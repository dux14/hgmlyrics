import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub supabase (requires env vars not available in test) — mismo patrón que
// songViewStageWiring.test.js / songViewHeroChips.test.js.
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
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn((key) => key === 'voz_tono'),
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

const roster = [
  { id: 'sop1', name: 'Soprano', category: 'soprano' },
  { id: 'ten1', name: 'Tenor', category: 'tenor' },
];

function buildSong(id, { withChords = true, withRoster = true } = {}) {
  return {
    id,
    title: 'Santo',
    schemaVersion: 3,
    voiceRoster: withRoster ? roster : [],
    sections: [
      {
        type: 'verse',
        label: 'V',
        lines: [
          {
            text: 'Santo es el Señor',
            chords: withChords ? [{ pos: 0, ch: 'D' }] : [],
            groups: (withRoster ? roster : []).map((v) => ({
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

describe('SongView — toolbar de capas (T3)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('la toolbar trae #layer-chords y #layer-tono, y ya no trae los controles viejos', async () => {
    const song = buildSong('song-toolbar-1');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-1');

    const toolbar = container.querySelector('.song-toolbar');
    expect(toolbar).toBeTruthy();

    const chordsBtn = toolbar.querySelector('#layer-chords');
    const tonoBtn = toolbar.querySelector('#layer-tono');
    expect(chordsBtn).toBeTruthy();
    expect(tonoBtn).toBeTruthy();
    expect(chordsBtn.getAttribute('aria-pressed')).toBe('false');
    expect(tonoBtn.getAttribute('aria-pressed')).toBe('false');

    expect(toolbar.querySelector('.chord-toggle')).toBeNull();
    expect(toolbar.querySelector('.font-controls')).toBeNull();
    expect(toolbar.querySelector('.transpose-controls')).toBeNull();

    expect(toolbar.querySelector('#enter-stage-btn')).toBeTruthy();
    expect(toolbar.querySelector('#open-options-sheet')).toBeTruthy();
    expect(toolbar.querySelector('#hero-tuner-mic')).toBeTruthy();
  });

  it('sin acordes ni roster: no se pintan los toggles de capa', async () => {
    const song = buildSong('song-toolbar-2', { withChords: false, withRoster: false });
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-2');

    const toolbar = container.querySelector('.song-toolbar');
    expect(toolbar.querySelector('#layer-chords')).toBeNull();
    expect(toolbar.querySelector('#layer-tono')).toBeNull();
  });

  it('ambas capas apagadas: la letra se renderiza plana (sin rieles de acordes/tono)', async () => {
    const song = buildSong('song-toolbar-3');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-3');

    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--chords')).toBe(false);
    expect(line.classList.contains('lyrics__line--tono')).toBe(false);
    expect(line.classList.contains('lyrics__line--mix')).toBe(false);
  });

  it('#layer-chords on: aparecen acordes (buildChordsLineHTML) y aria-pressed=true', async () => {
    const song = buildSong('song-toolbar-4');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-4');

    container.querySelector('#layer-chords').click();

    expect(container.querySelector('#layer-chords').getAttribute('aria-pressed')).toBe('true');
    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--chords')).toBe(true);
    expect(container.querySelector('.chord-label')).toBeTruthy();
  });

  it('modos excluyentes: activar Tono con Acordes activo apaga Acordes (OR, no mixed)', async () => {
    const song = buildSong('song-toolbar-5');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-5');

    container.querySelector('#layer-chords').click();
    container.querySelector('#layer-tono').click();

    expect(container.querySelector('#layer-chords').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('#layer-tono').getAttribute('aria-pressed')).toBe('true');
    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--mix')).toBe(false);
  });

  it('tap sobre la capa ya activa vuelve a Letra', async () => {
    const song = buildSong('song-toolbar-5b');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-5b');

    container.querySelector('#layer-chords').click();
    container.querySelector('#layer-chords').click();

    expect(container.querySelector('#layer-chords').getAttribute('aria-pressed')).toBe('false');
    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--chords')).toBe(false);
  });

  it('Tono sin voz elegida: panel Voz visible, letra plana (fallback) hasta seleccionar', async () => {
    const song = buildSong('song-toolbar-4b');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-4b');

    container.querySelector('#layer-tono').click();

    expect(container.querySelector('#layer-tono').getAttribute('aria-pressed')).toBe('true');
    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--tono')).toBe(false);
    expect(container.querySelector('#voice-panel')).toBeTruthy();
    expect(container.querySelector('#chords-extras').style.display).toBe('flex');
    // BUG: sin voz elegida, el panel debe abrir expandido (es el camino para
    // elegir voz) — no colapsado con los chips de categoria ocultos.
    expect(container.querySelector('#voice-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#voice-panel-body').hidden).toBe(false);
  });

  it('BUG: activar Tono con voz ya elegida no fuerza el panel a abrirse (respeta el estado colapsado actual)', async () => {
    const song = buildSong('song-toolbar-4d');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-4d');

    // Elige voz en modo Acordes primero (panel se abre manualmente y se cierra).
    container.querySelector('#layer-chords').click();
    container.querySelector('#voice-panel-toggle').click(); // abre
    container.querySelector('#voice-panel-categories [data-category="tenor"]').click();
    container.querySelector('#voice-panel-toggle').click(); // colapsa de nuevo
    expect(container.querySelector('#voice-panel-toggle').getAttribute('aria-expanded')).toBe('false');

    // Cambia a Tono: ya hay voz elegida, no debe forzar la expansion.
    container.querySelector('#layer-tono').click();

    expect(container.querySelector('#layer-tono').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('#voice-panel-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('solo #layer-tono on + voz elegida en el panel: aparece el render tono (buildTonoLineHTML)', async () => {
    const song = buildSong('song-toolbar-4c');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-4c');

    container.querySelector('#layer-tono').click();
    container.querySelector('#voice-panel-categories [data-category="tenor"]').click();

    expect(container.querySelector('#layer-tono').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('#layer-chords').getAttribute('aria-pressed')).toBe('false');
    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--tono')).toBe(true);
  });

  it('FINDING 1: capa Acordes global on (encendida en otra canción) no sangra en una canción sin acordes', async () => {
    const { setLayer } = await import('../src/lib/layerStore.js');
    setLayer('chords', true); // preferencia global, simula haberla encendido en otra canción con acordes

    const song = buildSong('song-toolbar-nochords', { withChords: false, withRoster: true });
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-nochords');

    // Sin acordes en la canción, el toggle ni siquiera se pinta (showToggle
    // gatea por hasChords/tonoAvailable) — no hay control para apagarlo.
    expect(container.querySelector('#layer-chords')).toBeNull();

    const line = container.querySelector('#lyrics-content .lyrics__line');
    expect(line.classList.contains('lyrics__line--chords')).toBe(false);
    expect(line.classList.contains('lyrics__line--no-chord')).toBe(false);
    expect(line.textContent.trim()).toBe('Santo es el Señor');
  });

  it('las capas persisten entre renders (layerStore)', async () => {
    const song = buildSong('song-toolbar-6');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    await renderSongView(container, 'song-toolbar-6');
    container.querySelector('#layer-chords').click();

    // Limpia el FAB de autoscroll (vive en document.body, no en el container)
    // antes del segundo render — mismo patrón que songViewStageWiring.test.js.
    document.body.innerHTML = '';

    const container2 = document.createElement('div');
    await renderSongView(container2, 'song-toolbar-6');
    expect(container2.querySelector('#layer-chords').getAttribute('aria-pressed')).toBe('true');
  });
});
