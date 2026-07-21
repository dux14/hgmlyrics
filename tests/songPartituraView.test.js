import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/icons.js', () => ({ icon: vi.fn(() => '') }));

const getSongStudio = vi.fn();
vi.mock('../src/lib/studioApi.js', () => ({ getSongStudio: (...args) => getSongStudio(...args) }));

const goBack = vi.fn();
let routeChangeCb = null;
const offRouteChange = vi.fn();
vi.mock('../src/router.js', () => ({
  goBack: (...args) => goBack(...args),
  onRouteChange: (cb) => {
    routeChangeCb = cb;
    return offRouteChange;
  },
}));

import { renderSongPartituraView } from '../src/components/pipeline/SongPartituraView.js';

// Caso realista: lead/backing tienen `.lines` (partitura de letra), male
// llega con `{notes}` sin `.lines` (voz sin letra) — no debe generar tab.
function makeStudioData(overrides = {}) {
  return {
    title: 'Cancion de prueba',
    stems: [],
    analysis: {
      voices_present: ['lead', 'backing', 'male'],
      voices: {
        lead: {
          lines: [{ syllables: [{ text: 'Me', note: 'C4' }] }],
        },
        backing: {
          lines: [{ syllables: [{ text: 'Coros', note: 'G3' }] }],
        },
        male: { notes: [] },
      },
    },
    sections: [],
    timings: null,
    ...overrides,
  };
}

describe('SongPartituraView (D5b)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    getSongStudio.mockReset();
    goBack.mockReset();
    offRouteChange.mockReset();
    routeChangeCb = null;
  });

  it('sin estudio (404 -> null): pinta estado vacio coherente', async () => {
    getSongStudio.mockResolvedValue(null);
    renderSongPartituraView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('.partitura-view__empty')).toBeTruthy();
    expect(container.textContent).toContain('todavía no tiene partitura publicada');
    expect(container.querySelector('.pipeline-view__back')).toBeTruthy();
  });

  it('estudio sin analysis: pinta estado vacio coherente', async () => {
    getSongStudio.mockResolvedValue({ title: 'X', stems: [], analysis: null });
    renderSongPartituraView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('.partitura-view__empty')).toBeTruthy();
  });

  it('back llama a goBack()', async () => {
    getSongStudio.mockResolvedValue(null);
    renderSongPartituraView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    container.querySelector('.pipeline-view__back').click();
    expect(goBack).toHaveBeenCalled();
  });

  it('con voces con letra: tabs solo para lead/backing (male sin .lines no aparece)', async () => {
    getSongStudio.mockResolvedValue(makeStudioData());
    renderSongPartituraView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    const tabs = container.querySelectorAll('.partitura__voice-tab');
    expect(tabs.length).toBe(2);
    expect([...tabs].map((t) => t.textContent)).toEqual(['Voz principal', 'Coros']);
    expect(tabs[0].classList.contains('is-active')).toBe(true);
  });

  it('primer tab activo renderiza sus lineas; click en otro tab cambia el render', async () => {
    getSongStudio.mockResolvedValue(makeStudioData());
    renderSongPartituraView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    const voiceEl = container.querySelector('.partitura-view__voice');
    expect(voiceEl.textContent).toContain('Me');
    expect(voiceEl.textContent).not.toContain('Coros');

    const tabs = container.querySelectorAll('.partitura__voice-tab');
    tabs[1].click();

    expect(voiceEl.textContent).toContain('Coros');
    expect(tabs[1].classList.contains('is-active')).toBe(true);
    expect(tabs[0].classList.contains('is-active')).toBe(false);
  });

  it('titulo de la cancion en el header', async () => {
    getSongStudio.mockResolvedValue(makeStudioData());
    renderSongPartituraView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('.partitura-view__title').textContent).toBe(
      'Cancion de prueba',
    );
  });
});
