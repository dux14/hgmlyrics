// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../lib/authStore.js', () => ({
  isFeatureEnabled: vi.fn((key) => key === 'voz_tono'),
}));

vi.mock('./OptionsSheet.js', () => ({
  openOptionsSheet: vi.fn(),
  closeOptionsSheet: vi.fn(),
  isOptionsSheetOpen: vi.fn(() => false),
}));

import { enterImmersive, exitImmersive } from './ImmersiveView.js';
import { openOptionsSheet, isOptionsSheetOpen } from './OptionsSheet.js';

/**
 * Canción fixture: 2 líneas cantables con acordes + grupos de nota para una
 * sola voz del roster (soprano), suficiente para ejercitar los 4 modos.
 */
function buildSong() {
  return {
    id: 'song-1',
    sections: [
      {
        type: 'verse',
        label: 'Verso 1',
        lines: [
          {
            text: 'Hola mundo',
            chords: [{ pos: 0, ch: 'C' }],
            groups: [{ start: 0, end: 4, voiceId: 'soprano', note: 'C4' }],
          },
          {
            text: 'Segunda linea',
            chords: [{ pos: 0, ch: 'G' }],
            groups: [{ start: 0, end: 7, voiceId: 'soprano', note: 'D4' }],
          },
        ],
      },
    ],
    voiceRoster: [{ id: 'soprano', name: 'Soprano', category: 'soprano' }],
  };
}

function buildCtx(song, overrides = {}) {
  return {
    song,
    getActiveVoice: () => null,
    getTranspose: () => ({ semitones: 0, useFlats: false }),
    getNotation: () => 'anglo',
    setActiveVoice: vi.fn(),
    pauseAutoscroll: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
}

describe('ImmersiveView — clases de modo por línea + paridad de voz', () => {
  let songViewEl;

  beforeEach(() => {
    // El modo persistido por immersiveStore (clave hkn-immersive-mode) no
    // debe filtrarse entre tests.
    localStorage.clear();
    songViewEl = document.createElement('div');
    document.body.appendChild(songViewEl);
  });

  afterEach(() => {
    exitImmersive();
    songViewEl.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    // clearAllMocks no revierte mockReturnValue: restaurar el default explícitamente
    isOptionsSheetOpen.mockReturnValue(false);
  });

  it('modo inicial es letra sin persistencia, aunque las capas de SongView tengan chords activo', () => {
    // Simula que SongView dejó la capa "acordes" activa antes de entrar al
    // full view. La vista inmersiva NO debe heredarla: sin nada persistido
    // bajo hkn-immersive-mode, el modo inicial siempre es 'letra'.
    localStorage.setItem('hkn-lyrics-layers', JSON.stringify({ chords: true, tono: false }));
    const song = buildSong();
    enterImmersive(songViewEl, buildCtx(song));

    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    expect(opts.mode).toBe('letra');

    const roll = document.getElementById('imm-roll');
    const lines = Array.from(roll.querySelectorAll('.imm-line'));
    lines.forEach((el) => {
      expect(el.classList.contains('lyrics__line--chords')).toBe(false);
    });
  });

  it('modo inicial respeta la elección persistida en hkn-immersive-mode sobre las capas', () => {
    localStorage.setItem('hkn-lyrics-layers', JSON.stringify({ chords: false, tono: false }));
    localStorage.setItem('hkn-immersive-mode', 'chords');
    const song = buildSong();
    enterImmersive(songViewEl, buildCtx(song));

    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    expect(opts.mode).toBe('chords');
  });

  it('modo chords: las líneas no-spoken llevan lyrics__line--chords', () => {
    const song = buildSong();
    enterImmersive(songViewEl, buildCtx(song));
    const roll = document.getElementById('imm-roll');
    const lines = Array.from(roll.querySelectorAll('.imm-line'));
    expect(lines).toHaveLength(2);

    // Fuerza modo chords vía el sheet mockeado: abre opciones y llama al
    // mismo callback que usaría el sheet real (onModeChange).
    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    opts.onModeChange('chords');

    const linesAfter = Array.from(roll.querySelectorAll('.imm-line'));
    linesAfter.forEach((el) => {
      expect(el.classList.contains('lyrics__line--chords')).toBe(true);
    });
  });

  it('modo mixed CON voz activa: la línea activa lleva --mix con nota; el resto --chords', () => {
    const song = buildSong();
    enterImmersive(songViewEl, buildCtx(song, { getActiveVoice: () => 'soprano' }));

    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    opts.onModeChange('mixed');

    const roll = document.getElementById('imm-roll');
    const lines = Array.from(roll.querySelectorAll('.imm-line'));
    expect(lines[0].classList.contains('lyrics__line--mix')).toBe(true);
    expect(lines[0].querySelector('.mix-rail--note')).not.toBeNull();
    expect(lines[1].classList.contains('lyrics__line--chords')).toBe(true);
  });

  it('modo mixed SIN voz activa: se abre el sheet de opciones', () => {
    const song = buildSong();
    openOptionsSheet.mockClear();
    enterImmersive(songViewEl, buildCtx(song, { getActiveVoice: () => null }));

    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    openOptionsSheet.mockClear();
    opts.onModeChange('mixed');

    expect(openOptionsSheet).toHaveBeenCalled();
  });

  it('al navegar en modo mixed, la línea que deja de ser activa pierde --mix y gana --chords', () => {
    const song = buildSong();
    enterImmersive(songViewEl, buildCtx(song, { getActiveVoice: () => 'soprano' }));

    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    opts.onModeChange('mixed');

    const roll = document.getElementById('imm-roll');
    let lines = Array.from(roll.querySelectorAll('.imm-line'));
    expect(lines[0].classList.contains('lyrics__line--mix')).toBe(true);

    // Tap en la segunda línea navega (goTo) y la re-pinta.
    lines[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    lines = Array.from(roll.querySelectorAll('.imm-line'));
    expect(lines[0].classList.contains('lyrics__line--mix')).toBe(false);
    expect(lines[0].classList.contains('lyrics__line--chords')).toBe(true);
    expect(lines[1].classList.contains('lyrics__line--mix')).toBe(true);
  });

  it('con el sheet abierto, cambiar de modo lo refresca al instante (no solo tono/mixed sin voz)', () => {
    const song = buildSong();
    enterImmersive(songViewEl, buildCtx(song, { getActiveVoice: () => 'soprano' }));

    // Abre el sheet (simula openEls != null en el módulo real) y captura el
    // callback onModeChange que usaría un click dentro del sheet real.
    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    isOptionsSheetOpen.mockReturnValue(true);
    openOptionsSheet.mockClear();

    // Modo 'chords' con voz ya activa: antes NO reabría el sheet. Con el
    // sheet abierto, ahora SÍ debe refrescarlo para reflejar el modo nuevo.
    opts.onModeChange('chords');

    expect(openOptionsSheet).toHaveBeenCalled();
  });

  it('con el sheet cerrado, cambiar a un modo fuera de tono/mixed NO reabre el sheet', () => {
    const song = buildSong();
    enterImmersive(songViewEl, buildCtx(song, { getActiveVoice: () => 'soprano' }));

    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    isOptionsSheetOpen.mockReturnValue(false);
    openOptionsSheet.mockClear();

    opts.onModeChange('chords');

    expect(openOptionsSheet).not.toHaveBeenCalled();
  });

  it('con el sheet cerrado, cambiar a tono/mixed CON voz activa tampoco reabre el sheet', () => {
    const song = buildSong();
    enterImmersive(songViewEl, buildCtx(song, { getActiveVoice: () => 'soprano' }));

    document.getElementById('imm-open-options').click();
    const opts = openOptionsSheet.mock.calls.at(-1)[0];
    isOptionsSheetOpen.mockReturnValue(false);
    openOptionsSheet.mockClear();

    opts.onModeChange('mixed');

    expect(openOptionsSheet).not.toHaveBeenCalled();
  });
});

describe('ImmersiveView — toggle maestro del metrónomo (TANDA B)', () => {
  let songViewEl;

  /** Fake AudioContext mínimo: createMetronomeClick lo crea lazy al desmutear. */
  function stubAudioContext() {
    class FakeAudioContext {
      constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
      }
      createOscillator() {
        return {
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          frequency: { value: 0 },
        };
      }
      createGain() {
        return {
          connect: vi.fn(),
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
        };
      }
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }
    globalThis.AudioContext = FakeAudioContext;
  }

  /** Monta una sesión sync (promoteToSync) con beats + BPM, esperando el `then` de getSongAudio. */
  async function enterSyncSessionWithBeats() {
    const song = buildSong();
    const { getSongAudio } = await import('../lib/songAudioApi.js');
    const { isFeatureEnabled } = await import('../lib/authStore.js');
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValueOnce({
      audio: { url: 'https://example.com/full.mp3', bpmManual: 120, timeSignature: '4/4' },
      timings: {
        status: 'ready',
        lines: [{ i: 0, startMs: 0 }, { i: 1, startMs: 4000 }],
        beats: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500],
      },
    });

    enterImmersive(songViewEl, buildCtx(song));
    // getSongAudio resuelve async (Promise.resolve/mockResolvedValueOnce): dejar correr microtasks.
    await Promise.resolve();
    await Promise.resolve();
    return song;
  }

  /**
   * Sesión sync con un hueco > GAP_INTERLUDIO_MS (5000ms) entre la línea 0 y
   * la 1 (0 -> 12000ms), único caso en que `timingEngine` dispara
   * `onInterlude` (showInterlude) — necesario para exercitar el guard
   * `s.metronomeOn` del count-in. Rejilla de 25 beats c/500ms (perBar=4):
   * a los 10000ms faltan exactamente 4 beats para la línea 1 (dentro de
   * `[1, perBar]`), el caso que muestra el contador cuando el toggle está ON.
   */
  async function enterSyncSessionForCountIn() {
    const song = buildSong();
    const { getSongAudio } = await import('../lib/songAudioApi.js');
    const { isFeatureEnabled } = await import('../lib/authStore.js');
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValueOnce({
      audio: { url: 'https://example.com/full.mp3', bpmManual: 120, timeSignature: '4/4' },
      timings: {
        status: 'ready',
        lines: [{ i: 0, startMs: 0 }, { i: 1, startMs: 12000 }],
        beats: Array.from({ length: 25 }, (_, i) => i * 500),
      },
    });

    enterImmersive(songViewEl, buildCtx(song));
    await Promise.resolve();
    await Promise.resolve();

    const audioEl = document.querySelector('#imm-player-slot audio');
    audioEl.currentTime = 2;
    audioEl.dispatchEvent(new Event('timeupdate'));
    return audioEl;
  }

  beforeEach(() => {
    localStorage.clear();
    stubAudioContext();
    songViewEl = document.createElement('div');
    document.body.appendChild(songViewEl);
  });

  afterEach(() => {
    exitImmersive();
    songViewEl.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    isOptionsSheetOpen.mockReturnValue(false);
    delete globalThis.AudioContext;
  });

  it('al montar una sesión sync con beats, el metrónomo arranca activado (badge+pulso visibles, click desmuteado)', async () => {
    await enterSyncSessionWithBeats();

    expect(document.getElementById('imm-pulse').hidden).toBe(false);
    expect(document.getElementById('imm-bpm-badge').hidden).toBe(false);
    const quickBtn = document.getElementById('imm-metronome-toggle');
    expect(quickBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('apagar el toggle oculta pulso+badge y mutea el click, sin destruir beatClock', async () => {
    await enterSyncSessionWithBeats();
    const quickBtn = document.getElementById('imm-metronome-toggle');

    quickBtn.click();

    expect(document.getElementById('imm-pulse').hidden).toBe(true);
    expect(document.getElementById('imm-bpm-badge').hidden).toBe(true);
    expect(quickBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('reencender el toggle restaura pulso+badge+click sin recrear el beatClock', async () => {
    await enterSyncSessionWithBeats();
    const quickBtn = document.getElementById('imm-metronome-toggle');

    quickBtn.click(); // apaga
    quickBtn.click(); // reenciende

    expect(document.getElementById('imm-pulse').hidden).toBe(false);
    expect(document.getElementById('imm-bpm-badge').hidden).toBe(false);
    expect(quickBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('count-in con metrónomo ON: faltando exactamente perBar beats pinta .imm-interlude__count', async () => {
    const audioEl = await enterSyncSessionForCountIn();

    audioEl.currentTime = 10; // faltan 4 beats (== perBar) para la línea 1 (12000ms)
    audioEl.dispatchEvent(new Event('timeupdate'));

    const count = document.querySelector('#imm-roll .imm-interlude__count');
    expect(count).toBeTruthy();
    expect(count.textContent).toBe('4');
    expect(document.querySelectorAll('#imm-roll .imm-interlude__dot').length).toBe(0);
  });

  it('count-in con metrónomo OFF: el mismo hueco cae a los puntitos, sin .imm-interlude__count', async () => {
    const audioEl = await enterSyncSessionForCountIn();
    document.getElementById('imm-metronome-toggle').click(); // apaga el toggle maestro

    audioEl.currentTime = 10; // mismo remainingBeats=4 que el test ON
    audioEl.dispatchEvent(new Event('timeupdate'));

    expect(document.querySelector('#imm-roll .imm-interlude__count')).toBeNull();
    expect(document.querySelectorAll('#imm-roll .imm-interlude__dot').length).toBe(3);
  });
});
