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

const createMultiTrackPlayer = vi.fn();
vi.mock('../src/components/pipeline/MultiTrackPlayer.js', () => ({
  createMultiTrackPlayer: (...args) => createMultiTrackPlayer(...args),
}));

const createToneLyrics = vi.fn();
vi.mock('../src/components/pipeline/ToneLyrics.js', () => ({
  createToneLyrics: (...args) => createToneLyrics(...args),
}));

import { renderSongStudioView } from '../src/components/pipeline/SongStudioView.js';

function makePlayerStub() {
  return {
    el: document.createElement('div'),
    destroy: vi.fn(),
    onTime: vi.fn(),
    seek: vi.fn(),
  };
}
function makeToneStub(voices = []) {
  return {
    el: document.createElement('div'),
    setActiveTime: vi.fn(),
    setVoiceDimmed: vi.fn(),
    destroy: vi.fn(),
    voices,
  };
}

function makeStudioData(overrides = {}) {
  return {
    title: 'Cancion de prueba',
    stems: [
      { kind: 'vocals', url: 'https://x/v.mp3', display: null, durationSec: 100 },
      { kind: 'drums', url: 'https://x/d.mp3', display: null, durationSec: 100 },
    ],
    // Caso realista: lead/backing tienen `.lines` (ToneLyrics las pinta),
    // male/female llegan con `{notes}` sin `.lines` (ToneLyrics NO les
    // pinta nada, así que no deben generar ítem de leyenda).
    analysis: {
      voices_present: ['lead', 'backing', 'male', 'female'],
      voices: {
        lead: { lines: [{ syllables: [{ text: 'Me', start: 0, end: 0.2, note: 'C4' }] }] },
        backing: { lines: [{ syllables: [{ text: 'Me', start: 0, end: 0.2, note: 'G3' }] }] },
        male: { notes: [] },
        female: { notes: [] },
      },
    },
    sections: [],
    timings: null,
    ...overrides,
  };
}

describe('SongStudioView', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    getSongStudio.mockReset();
    goBack.mockReset();
    offRouteChange.mockReset();
    createMultiTrackPlayer.mockReset();
    createToneLyrics.mockReset();
    routeChangeCb = null;
  });

  it('sin estudio (404 -> null): pinta estado vacio coherente', async () => {
    getSongStudio.mockResolvedValue(null);
    renderSongStudioView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('.studio-view__empty')).toBeTruthy();
    expect(container.textContent).toContain('todavía no tiene estudio publicado');
    expect(container.querySelector('.pipeline-view__back')).toBeTruthy();
    expect(createMultiTrackPlayer).not.toHaveBeenCalled();
    expect(createToneLyrics).not.toHaveBeenCalled();
  });

  it('back llama a goBack()', async () => {
    getSongStudio.mockResolvedValue(null);
    renderSongStudioView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    container.querySelector('.pipeline-view__back').click();
    expect(goBack).toHaveBeenCalled();
  });

  it('con datos: monta player + tone, mapea labels y grupos, wirea onTime', async () => {
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(makeStudioData());

    renderSongStudioView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(createMultiTrackPlayer).toHaveBeenCalledTimes(1);
    const { tracks } = createMultiTrackPlayer.mock.calls[0][0];
    expect(tracks).toEqual([
      expect.objectContaining({ kind: 'vocals', label: 'Voz', group: 'voces' }),
      expect.objectContaining({ kind: 'drums', label: 'Batería', group: 'instrumentos' }),
    ]);

    expect(createToneLyrics).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.studio-view__player').contains(playerStub.el)).toBe(true);
    expect(container.querySelector('.studio-view__lyrics').contains(toneStub.el)).toBe(true);

    // Wiring de tiempo: onTime(cb) -> cb(sec) debe llamar setActiveTime.
    expect(playerStub.onTime).toHaveBeenCalledTimes(1);
    const timeCb = playerStub.onTime.mock.calls[0][0];
    timeCb(12.3);
    expect(toneStub.setActiveTime).toHaveBeenCalledWith(12.3);

    // onSeek de ToneLyrics hace seek del player.
    const { onSeek } = createToneLyrics.mock.calls[0][0];
    onSeek(5);
    expect(playerStub.seek).toHaveBeenCalledWith(5);

    // Titulo.
    expect(container.querySelector('.pipeline-view__title').textContent).toBe('Cancion de prueba');
  });

  it('click en un item de la leyenda llama setVoiceDimmed (toggle), solo con voces que ToneLyrics pinta', async () => {
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub([
      { key: 'lead', role: 'lead', label: 'Voz principal' },
      { key: 'backing', role: 'alt', label: 'Alterna' },
    ]);
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(makeStudioData());

    renderSongStudioView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    // Leyenda: SOLO lead + backing (male/female no tienen .lines, ToneLyrics
    // no les pinta notas, así que no aparecen — no hay ítem "Coros" muerto).
    const items = container.querySelectorAll('.studio-view__legend-item');
    expect(items.length).toBe(2);

    items[1].click();
    expect(toneStub.setVoiceDimmed).toHaveBeenCalledWith('backing', true);
    expect(items[1].getAttribute('aria-pressed')).toBe('true');

    items[1].click();
    expect(toneStub.setVoiceDimmed).toHaveBeenCalledWith('backing', false);
    expect(items[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('teardown en cambio de ruta llama destroy() de ambos y desuscribe', async () => {
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(makeStudioData());

    renderSongStudioView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(routeChangeCb).toBeTypeOf('function');
    routeChangeCb();

    expect(playerStub.destroy).toHaveBeenCalledTimes(1);
    expect(toneStub.destroy).toHaveBeenCalledTimes(1);
    expect(offRouteChange).toHaveBeenCalledTimes(1);
  });

  it('sin stems (grupo vacio): no crashea, no crea filas de mas', async () => {
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(makeStudioData({ stems: [] }));

    renderSongStudioView(container, 'song-1');
    await Promise.resolve();
    await Promise.resolve();

    const { tracks } = createMultiTrackPlayer.mock.calls[0][0];
    expect(tracks).toEqual([]);
  });
});
