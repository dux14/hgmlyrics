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
}));

import { enterImmersive, exitImmersive } from './ImmersiveView.js';
import { openOptionsSheet } from './OptionsSheet.js';

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
});
