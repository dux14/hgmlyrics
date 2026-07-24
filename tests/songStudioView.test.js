import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/icons.js', () => ({ icon: vi.fn(() => '') }));

const getSongStudio = vi.fn();
vi.mock('../src/lib/studioApi.js', () => ({ getSongStudio: (...args) => getSongStudio(...args) }));

const goBack = vi.fn();
const navigate = vi.fn();
let routeChangeCb = null;
const offRouteChange = vi.fn();
vi.mock('../src/router.js', () => ({
  goBack: (...args) => goBack(...args),
  navigate: (...args) => navigate(...args),
  onRouteChange: (cb) => {
    routeChangeCb = cb;
    return offRouteChange;
  },
}));

const isAdmin = vi.fn();
vi.mock('../src/lib/authStore.js', () => ({ isAdmin: (...args) => isAdmin(...args) }));

const createMultiTrackPlayer = vi.fn();
vi.mock('../src/components/pipeline/MultiTrackPlayer.js', () => ({
  createMultiTrackPlayer: (...args) => createMultiTrackPlayer(...args),
}));

const createToneLyrics = vi.fn();
vi.mock('../src/components/pipeline/ToneLyrics.js', () => ({
  createToneLyrics: (...args) => createToneLyrics(...args),
}));

const createSectionAudioManager = vi.fn();
vi.mock('../src/components/SectionPlayer.js', () => ({
  createSectionAudioManager: (...args) => createSectionAudioManager(...args),
}));

import { renderSongStudioView } from '../src/components/pipeline/SongStudioView.js';

function makePlayerStub() {
  const el = (c) => {
    const d = document.createElement('div');
    d.className = c;
    return d;
  };
  return {
    el: document.createElement('div'),
    els: {
      transport: el('mtp__transport'),
      practice: el('mtp__practice'),
      sections: el('mtp__sections'),
      nowSound: el('mtp__nowsound'),
      mixer: el('mtp__tracks'),
      audios: el('mtp__audios'),
    },
    destroy: vi.fn(),
    onTime: vi.fn(),
    onPlay: vi.fn(),
    seek: vi.fn(),
    pause: vi.fn(),
    getActiveSection: vi.fn(() => 0),
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
    structure: null,
    timings: null,
    clips: [],
    ...overrides,
  };
}

describe('SongStudioView', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    getSongStudio.mockReset();
    goBack.mockReset();
    navigate.mockReset();
    offRouteChange.mockReset();
    createMultiTrackPlayer.mockReset();
    createToneLyrics.mockReset();
    createSectionAudioManager.mockReset();
    isAdmin.mockReset();
    isAdmin.mockReturnValue(false);
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
    const body = container.querySelector('.studio-view__body');
    expect(body.contains(playerStub.els.transport)).toBe(true);
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

  it('layout B: transporte, práctica, chips, roll, nowsound, mixer — en ese orden', async () => {
    isAdmin.mockReturnValue(false);
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(makeStudioData());
    renderSongStudioView(container, 's1');
    await Promise.resolve();
    await Promise.resolve();
    const body = container.querySelector('.studio-view__body');
    const order = [...body.children].map((n) => n.className.split(' ')[0]);
    expect(order).toEqual([
      'mtp__transport',
      'mtp__practice',
      'mtp__sections',
      'studio-view__legend',
      'studio-view__lyrics',
      'mtp__nowsound',
      'mtp__tracks',
      'mtp__audios',
    ]);
  });

  it('botón Editar solo para admin y navega a procesamiento', async () => {
    isAdmin.mockReturnValue(true);
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(makeStudioData());
    renderSongStudioView(container, 's1');
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('.studio-view__edit')).not.toBeNull();

    container.querySelector('.studio-view__edit').click();
    expect(navigate).toHaveBeenCalledWith('/song/s1/procesamiento');
  });

  it('sin admin: no muestra el botón Editar', async () => {
    isAdmin.mockReturnValue(false);
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(makeStudioData());
    renderSongStudioView(container, 's1');
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('.studio-view__edit')).toBeNull();
  });

  it('pasa structure y timings a ToneLyrics (headers + confianza cableados)', async () => {
    isAdmin.mockReturnValue(false);
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    const data = makeStudioData({
      structure: { segments: [{ label: 'verso', startMs: 0, endMs: 1000 }] },
      timings: { status: 'ready', lines: [] },
    });
    getSongStudio.mockResolvedValue(data);
    renderSongStudioView(container, 's1');
    await Promise.resolve();
    await Promise.resolve();
    const arg = createToneLyrics.mock.calls[0][0];
    expect(arg.structure).toEqual(data.structure);
    expect(arg.timings).toEqual(data.timings);
  });

  it('con clips: botón "Escuchar solo esta sección" pausa el multitrack al reproducir', async () => {
    isAdmin.mockReturnValue(false);
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    const clipTrack = {
      id: 'clip-0',
      sectionIndex: 0,
      url: 'https://x/c0.mp3',
      label: null,
      durationSec: 12,
      voiceScope: null,
    };
    const managerStub = {
      tracksFor: vi.fn(() => [clipTrack]),
      play: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    };
    createSectionAudioManager.mockReturnValue(managerStub);
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(
      makeStudioData({
        structure: { segments: [{ label: 'verso', startMs: 0, endMs: 12000 }] },
        clips: [clipTrack],
      }),
    );
    renderSongStudioView(container, 's1');
    await Promise.resolve();
    await Promise.resolve();
    const btn = container.querySelector('.studio-view__clip');
    expect(btn).not.toBeNull();
    btn.click();
    expect(playerStub.pause).toHaveBeenCalled();
    expect(managerStub.play).toHaveBeenCalledWith(clipTrack);
  });

  it('con clips: el multitrack arranca -> pausa el clip (exclusión inversa)', async () => {
    isAdmin.mockReturnValue(false);
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    const clipTrack = {
      id: 'clip-0',
      sectionIndex: 0,
      url: 'https://x/c0.mp3',
      label: null,
      durationSec: 12,
      voiceScope: null,
    };
    const managerStub = {
      tracksFor: vi.fn(() => [clipTrack]),
      play: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    };
    createSectionAudioManager.mockReturnValue(managerStub);
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(
      makeStudioData({
        structure: { segments: [{ label: 'verso', startMs: 0, endMs: 12000 }] },
        clips: [clipTrack],
      }),
    );
    renderSongStudioView(container, 's1');
    await Promise.resolve();
    await Promise.resolve();

    expect(playerStub.onPlay).toHaveBeenCalledTimes(1);
    const playCb = playerStub.onPlay.mock.calls[0][0];
    playCb();
    expect(managerStub.pause).toHaveBeenCalled();
  });

  it('recompute del botón disabled en onTime: sección sin clip lo deshabilita, con clip lo habilita', async () => {
    isAdmin.mockReturnValue(false);
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    const clipTrack = {
      id: 'clip-0',
      sectionIndex: 0,
      url: 'https://x/c0.mp3',
      label: null,
      durationSec: 12,
      voiceScope: null,
    };
    const managerStub = {
      tracksFor: vi.fn(() => []),
      play: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    };
    createSectionAudioManager.mockReturnValue(managerStub);
    // Sección activa sin clip al momento del recompute (tracksFor -> []).
    playerStub.getActiveSection = vi.fn(() => 1);
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(
      makeStudioData({
        structure: {
          segments: [
            { label: 'verso', startMs: 0, endMs: 12000 },
            { label: 'coro', startMs: 12000, endMs: 24000 },
          ],
        },
        clips: [clipTrack],
      }),
    );
    renderSongStudioView(container, 's1');
    await Promise.resolve();
    await Promise.resolve();

    const clipBtn = container.querySelector('.studio-view__clip');
    expect(clipBtn.disabled).toBe(true);

    // El segundo registro de onTime (el primero es el wiring de tone) es el
    // refresh del botón de clip — invocarlo recalcula disabled.
    expect(playerStub.onTime.mock.calls.length).toBeGreaterThanOrEqual(2);
    const refreshCb = playerStub.onTime.mock.calls[1][0];

    managerStub.tracksFor.mockReturnValue([clipTrack]);
    refreshCb(5);
    expect(clipBtn.disabled).toBe(false);

    managerStub.tracksFor.mockReturnValue([]);
    refreshCb(5);
    expect(clipBtn.disabled).toBe(true);
  });

  it('sin clips: no se pinta el botón', async () => {
    isAdmin.mockReturnValue(false);
    const playerStub = makePlayerStub();
    const toneStub = makeToneStub();
    createMultiTrackPlayer.mockReturnValue(playerStub);
    createToneLyrics.mockReturnValue(toneStub);
    getSongStudio.mockResolvedValue(makeStudioData({ clips: [] }));
    renderSongStudioView(container, 's1');
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('.studio-view__clip')).toBeNull();
  });
});
