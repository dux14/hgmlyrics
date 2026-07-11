import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub pitch detector (requiere AudioContext/getUserMedia, no disponible en
// jsdom) — mismo patrón que tests/stageMode.test.js.
const detectorStart = vi.fn();
const detectorStop = vi.fn();
vi.mock('../src/lib/pitch.js', () => ({
  createPitchDetector: vi.fn(() => ({
    start: detectorStart,
    stop: detectorStop,
    isRunning: () => false,
  })),
}));

// 'voz_tono' siempre on para poder probar mixed/tono sin depender del
// catálogo real de flags (mismo patrón que tests/stageMode.test.js).
// 'immersive_player' (D3) default OFF — cada test del player lo enciende
// explícitamente, así el resto de la suite (30+ tests preexistentes) no se
// ve afectada por el nuevo flag.
vi.mock('../src/lib/authStore.js', () => ({
  isFeatureEnabled: vi.fn((key) => key === 'voz_tono'),
}));

// getSongAudio (D3): default null (sin audio/timings) para que ningún test
// preexistente dispare una promoción a sync por accidente; cada test del
// player lo sobreescribe con mockResolvedValueOnce.
vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn(() => Promise.resolve(null)),
}));

import { enterImmersive, exitImmersive } from '../src/components/ImmersiveView.js';
import { setLayer } from '../src/lib/layerStore.js';
import {
  buildLetraLineHTML,
  buildChordsLineHTML,
  buildMixedLineHTML,
} from '../src/lib/lyricsRender.js';
import { closeOptionsSheet } from '../src/components/OptionsSheet.js';
import { isFeatureEnabled } from '../src/lib/authStore.js';
import { getSongAudio } from '../src/lib/songAudioApi.js';

/** Deja correr la cadena de microtasks del `getSongAudio(...).then(...)` de maybeLoadSyncAudio. */
async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

function mountSongView() {
  document.body.innerHTML = `<div class="song-view" id="sv"></div>`;
  return document.getElementById('sv');
}

function buildSong(overrides = {}) {
  return {
    id: 'song-1',
    schemaVersion: 3,
    voiceRoster: [{ id: 'soprano-1', name: 'Soprano', category: 'soprano' }],
    sections: [
      {
        type: 'verse',
        label: 'Verso 1',
        lines: [
          {
            text: 'Primera línea',
            chords: [{ pos: 0, ch: 'C' }],
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' }],
          },
          {
            text: 'Segunda línea',
            chords: [{ pos: 0, ch: 'G' }],
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'D4' }],
          },
          {
            text: 'Tercera línea',
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'E4' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function buildTwoSectionSong() {
  return buildSong({
    sections: [
      {
        type: 'verse',
        label: 'Verso 1',
        lines: [
          {
            text: 'Primera línea',
            chords: [{ pos: 0, ch: 'C' }],
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' }],
          },
        ],
      },
      {
        type: 'chorus',
        label: 'Coro',
        lines: [
          {
            text: 'Línea del coro',
            chords: [{ pos: 0, ch: 'G' }],
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'D4' }],
          },
        ],
      },
    ],
  });
}

function buildMultiVoiceSong() {
  return buildSong({
    voiceRoster: [
      { id: 'soprano-1', name: 'Soprano', category: 'soprano' },
      { id: 'tenor-1', name: 'Tenor', category: 'tenor' },
    ],
    sections: [
      {
        type: 'verse',
        label: 'Verso 1',
        lines: [
          {
            text: 'Primera línea',
            chords: [{ pos: 0, ch: 'C' }],
            groups: [
              { start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' },
              { start: 0, end: 7, voiceId: 'tenor-1', note: 'G3' },
            ],
          },
          {
            text: 'Segunda línea',
            groups: [
              { start: 0, end: 7, voiceId: 'soprano-1', note: 'D4' },
              { start: 0, end: 7, voiceId: 'tenor-1', note: 'A3' },
            ],
          },
        ],
      },
    ],
  });
}

beforeEach(() => {
  exitImmersive(); // limpia estado entre tests
  document.body.innerHTML = '';
  document.body.className = '';
  localStorage.clear();
  setLayer('chords', false);
  setLayer('tono', false);
  detectorStart.mockClear();
  detectorStop.mockClear();
  isFeatureEnabled.mockImplementation((key) => key === 'voz_tono');
  getSongAudio.mockReset();
  getSongAudio.mockResolvedValue(null);
});

afterEach(() => {
  exitImmersive();
  closeOptionsSheet();
});

describe('enterImmersive/exitImmersive', () => {
  it('no hace nada sin ctx.song', () => {
    const sv = mountSongView();
    enterImmersive(sv);
    expect(document.querySelector('.imm-v1')).toBeNull();
  });

  it('monta el overlay con TODAS las líneas y activa el índice 0', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(sv.classList.contains('song-view--immersive')).toBe(true);
    expect(document.body.classList.contains('immersive-active')).toBe(true);

    const lines = document.querySelectorAll('#imm-roll .imm-line');
    expect(lines).toHaveLength(3);
    expect(lines[0].classList.contains('imm-line--active')).toBe(true);
    expect(lines[0].dataset.i).toBe('0');
    expect(document.getElementById('imm-section').textContent).toBe('Verso 1');
  });

  it('modo letra (default): todas las líneas usan buildLetraLineHTML', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const lines = document.querySelectorAll('#imm-roll .imm-line');
    expect(lines[0].innerHTML).toBe(buildLetraLineHTML('Primera línea'));
    expect(lines[1].innerHTML).toBe(buildLetraLineHTML('Segunda línea'));
  });

  it("modo 'chords': línea activa contiene acordes; la vecina también (atenuada por CSS)", () => {
    setLayer('chords', true);
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const lines = document.querySelectorAll('#imm-roll .imm-line');
    const expectedActive = buildChordsLineHTML('Primera línea', [{ pos: 0, ch: 'C' }], {
      notation: 'anglo',
    });
    const expectedNeighbor = buildChordsLineHTML('Segunda línea', [{ pos: 0, ch: 'G' }], {
      notation: 'anglo',
    });
    expect(lines[0].innerHTML).toBe(expectedActive);
    expect(lines[1].innerHTML).toBe(expectedNeighbor);
    expect(lines[1].classList.contains('imm-line--active')).toBe(false);
  });

  it("modo 'mixed': la activa usa el riel mix-rail; las vecinas SOLO acordes", () => {
    // layerStore es excluyente (chords/tono no pueden ir juntos ahí) — el
    // modo 'mixed' es propio de immersiveStore, así que se fuerza vía su
    // clave persistida en vez de depender de la herencia de capas.
    localStorage.setItem('hkn-immersive-mode', 'mixed');
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const lines = document.querySelectorAll('#imm-roll .imm-line');
    const line0 = { text: 'Primera línea', groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' }] };
    const expectedActive = buildMixedLineHTML(
      line0,
      [{ pos: 0, ch: 'C' }],
      'soprano-1',
      'voice-text--soprano',
      { notation: 'anglo' },
    );
    expect(lines[0].innerHTML).toBe(expectedActive);
    expect(lines[0].innerHTML).toContain('mix-rail');
    expect(lines[1].innerHTML).not.toContain('mix-rail');
    expect(lines[1].innerHTML).toBe(
      buildChordsLineHTML('Segunda línea', [{ pos: 0, ch: 'G' }], { notation: 'anglo' }),
    );
  });

  it("modo 'tono' sin voz elegida auto-abre el selector (sheet)", () => {
    setLayer('tono', true);
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong() }); // sin getActiveVoice: activeVoiceId null
    expect(document.querySelector('.osheet')).toBeTruthy();
    expect(document.querySelector('.osheet [data-voice]')).toBeTruthy();
  });

  it('chips S·A·T·B solo visibles en modos mixed/tono', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('imm-voice-chips').hidden).toBe(true); // modo letra default

    exitImmersive();
    setLayer('tono', true);
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('imm-voice-chips').hidden).toBe(false);
  });

  it('tap en una línea (data-i) navega a esa línea y actualiza distancia/sección', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const target = document.querySelector('#imm-roll .imm-line[data-i="2"]');
    target.click();

    const lines = document.querySelectorAll('#imm-roll .imm-line');
    expect(lines[2].classList.contains('imm-line--active')).toBe(true);
    expect(lines[0].classList.contains('imm-line--d2')).toBe(true);
    expect(lines[1].classList.contains('imm-line--d1')).toBe(true);
  });

  it('goTo cruzando de sección actualiza el label del chrome (no solo la distancia)', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildTwoSectionSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('imm-section').textContent).toBe('Verso 1');

    document.querySelector('#imm-roll .imm-line[data-i="1"]').click(); // línea del Coro

    expect(document.getElementById('imm-section').textContent).toBe('Coro');
    expect(
      document.getElementById('imm-section').classList.contains('imm-v1__section--chorus'),
    ).toBe(true);
  });

  it('avanza sola tras el intervalo de la sección (TimerEngine)', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    vi.advanceTimersByTime(8000); // > 7.4s (velocidad default 0.5) pero < 2 intervalos
    const lines = document.querySelectorAll('#imm-roll .imm-line');
    expect(lines[1].classList.contains('imm-line--active')).toBe(true);
    vi.useRealTimers();
  });

  it('el botón salir cierra la vista', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('imm-exit').click();
    expect(document.querySelector('.imm-v1')).toBeNull();
  });

  it('Escape sale de la vista', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.imm-v1')).toBeNull();
  });

  it('exitImmersive limpia listeners, body class, mic y wake lock, y es idempotente', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.querySelector('.imm-v1__tuner-toggle').click(); // arranca el mic
    expect(detectorStart).toHaveBeenCalledTimes(1);

    exitImmersive();
    expect(document.querySelector('.imm-v1')).toBeNull();
    expect(sv.classList.contains('song-view--immersive')).toBe(false);
    expect(document.body.classList.contains('immersive-active')).toBe(false);
    expect(detectorStop).toHaveBeenCalledTimes(1);

    expect(() => vi.advanceTimersByTime(60000)).not.toThrow();
    expect(() => exitImmersive()).not.toThrow(); // segunda vez: no-op
    vi.useRealTimers();
  });

  it('llama a ctx.pauseAutoscroll una vez al entrar y ctx.onExit al salir', () => {
    const sv = mountSongView();
    const pauseAutoscroll = vi.fn();
    const onExit = vi.fn();
    enterImmersive(sv, { song: buildSong(), pauseAutoscroll, onExit });
    expect(pauseAutoscroll).toHaveBeenCalledTimes(1);
    exitImmersive();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('llamar enterImmersive dos veces seguidas sin exit intermedio es no-op la segunda vez (guard de reentrada)', () => {
    const sv = mountSongView();
    const pauseAutoscroll = vi.fn();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1', pauseAutoscroll });
    expect(document.querySelectorAll('.imm-v1')).toHaveLength(1);

    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1', pauseAutoscroll });
    expect(document.querySelectorAll('.imm-v1')).toHaveLength(1); // no monta un segundo overlay
    expect(pauseAutoscroll).toHaveBeenCalledTimes(1); // el 2do enter ni siquiera llegó a leer ctx
  });
});

describe('afinador: widget híbrido aprobado (FloatingTuner) montado bajo demanda', () => {
  it('el toggle nace apagado (mic nunca auto-arranca al entrar, panel vacío)', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const toggle = document.querySelector('.imm-v1__tuner-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('imm-tuner-panel').hidden).toBe(true);
    expect(document.querySelector('.floating-tuner')).toBeNull();
    expect(detectorStart).not.toHaveBeenCalled();
  });

  it('activar el toggle monta el widget híbrido dentro del panel y arranca el detector; desactivarlo lo desmonta y lo para', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const toggle = document.querySelector('.imm-v1__tuner-toggle');

    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('imm-tuner-panel').hidden).toBe(false);
    // El widget híbrido aprobado (nota grande + gauge 5 zonas + chip "Seguir
    // nota" propio) es `.floating-tuner` — NO la franja delgada de ImmersiveView.
    expect(document.querySelector('#imm-tuner-panel .floating-tuner')).toBeTruthy();
    expect(detectorStart).toHaveBeenCalledTimes(1);

    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.floating-tuner')).toBeNull();
    expect(detectorStop).toHaveBeenCalledTimes(1);
  });

  it('cerrar el widget desde su propia X resincroniza el toggle y esconde el panel', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.querySelector('.imm-v1__tuner-toggle').click();

    document.querySelector('[aria-label="Cerrar afinador"]').click();

    expect(document.querySelector('.imm-v1__tuner-toggle').getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(document.getElementById('imm-tuner-panel').hidden).toBe(true);
    expect(detectorStop).toHaveBeenCalledTimes(1);
  });

  it('exitImmersive para SIEMPRE el detector, incluso con el widget abierto', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.querySelector('.imm-v1__tuner-toggle').click();
    expect(detectorStart).toHaveBeenCalledTimes(1);

    exitImmersive();
    expect(detectorStop).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.floating-tuner')).toBeNull();
  });

  it('no crashea si se sale sin haber abierto el afinador', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(() => exitImmersive()).not.toThrow();
    expect(detectorStop).not.toHaveBeenCalled();
  });
});

describe('gestos (swipe horizontal/vertical, tap vs swipe)', () => {
  function dispatchPointer(el, type, x, y) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y }));
  }

  it('swipe horizontal hacia la izquierda avanza a la línea siguiente', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const viewport = document.getElementById('imm-viewport');

    dispatchPointer(viewport, 'pointerdown', 300, 300);
    dispatchPointer(document, 'pointermove', 200, 300);
    dispatchPointer(document, 'pointerup', 200, 300); // dx=-100 >= 40px

    expect(
      document.querySelector('#imm-roll .imm-line[data-i="1"]').classList.contains('imm-line--active'),
    ).toBe(true);
  });

  it('swipe vertical hacia arriba aumenta la velocidad y la persiste', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const viewport = document.getElementById('imm-viewport');

    dispatchPointer(viewport, 'pointerdown', 100, 300);
    dispatchPointer(document, 'pointermove', 100, 200);
    dispatchPointer(document, 'pointerup', 100, 200); // dy=-100 >= 40px

    const stored = Number.parseFloat(localStorage.getItem('hkn-autoscroll-speed:song-1'));
    expect(stored).toBeGreaterThan(0.5);
  });

  it('un tap corto no dispara swipe: primero despierta el chrome, luego pausa', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const viewport = document.getElementById('imm-viewport');
    const overlay = document.querySelector('.imm-v1');

    viewport.click(); // controles ya visibles al entrar -> pausa
    expect(overlay.classList.contains('imm-v1--paused')).toBe(true);
    vi.useRealTimers();
  });
});

// Portados de tests/stageMode.test.js (Task C5): el FAB de pausa y el
// auto-ocultado fijo de controles en pausa son la misma promesa de
// comportamiento que tenía el extinto modo escenario.
describe('FAB de pausa (#imm-fab) y controles fijos mientras está pausado', () => {
  it('togglea pausa/reanuda el motor de avance e invierte el icono del FAB', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const overlay = document.querySelector('.imm-v1');
    const fab = document.getElementById('imm-fab');

    fab.click();
    expect(overlay.classList.contains('imm-v1--paused')).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(
      document.querySelector('#imm-roll .imm-line[data-i="0"]').classList.contains('imm-line--active'),
    ).toBe(true); // sin avanzar

    fab.click();
    expect(overlay.classList.contains('imm-v1--paused')).toBe(false);
    vi.advanceTimersByTime(8000);
    expect(
      document.querySelector('#imm-roll .imm-line[data-i="1"]').classList.contains('imm-line--active'),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('en pausa los controles quedan fijos (sin auto-ocultado); al reanudar se re-arma el auto-hide', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const chrome = document.getElementById('imm-chrome');
    const fab = document.getElementById('imm-fab');

    fab.click(); // pausa
    expect(chrome.classList.contains('imm-v1__chrome--hidden')).toBe(false);
    vi.advanceTimersByTime(3500); // > CONTROLS_HIDE_MS
    expect(chrome.classList.contains('imm-v1__chrome--hidden')).toBe(false); // siguen visibles, pausado

    fab.click(); // reanuda
    expect(chrome.classList.contains('imm-v1__chrome--hidden')).toBe(false); // el FAB despierta el chrome
    vi.advanceTimersByTime(3500);
    expect(chrome.classList.contains('imm-v1__chrome--hidden')).toBe(true); // se re-arma el auto-hide
    vi.useRealTimers();
  });
});

// Portados de tests/stageMode.test.js (Task C5, gap de cobertura post-review):
// chips S·A·T·B — mismo comportamiento que tenía el extinto modo escenario.
// Requieren modo mixed/tono para que #imm-voice-chips quede visible.
describe('chips de voz S·A·T·B en la vista inmersiva', () => {
  it('pinta un chip por categoría presente en el roster, con la voz activa marcada', () => {
    setLayer('tono', true);
    const sv = mountSongView();
    enterImmersive(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1' });
    const chips = document.querySelectorAll('#imm-voice-chips [data-category]');
    expect(chips).toHaveLength(2); // soprano + tenor (no contralto/bajo en el roster)
    const sopranoChip = document.querySelector('[data-category="soprano"]');
    expect(sopranoChip.classList.contains('imm-v1__voice-chip--active')).toBe(true);
  });

  it('tap en un chip cambia la voz activa y la nota mostrada sin salir de la vista', () => {
    // La nota solo se pinta vía el render por capas (modo tono), así que esta
    // aserción necesita la capa Tono encendida para que la nota sea observable.
    setLayer('tono', true);
    const sv = mountSongView();
    enterImmersive(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1' });
    const activeLine = () => document.querySelector('#imm-roll .imm-line[data-i="0"]');
    expect(activeLine().textContent).toContain('C4');

    document.querySelector('[data-category="tenor"]').click();

    expect(document.querySelector('.imm-v1')).toBeTruthy(); // sigue en la vista
    expect(activeLine().textContent).toContain('G3');
    expect(
      document.querySelector('[data-category="tenor"]').classList.contains('imm-v1__voice-chip--active'),
    ).toBe(true);
    expect(
      document.querySelector('[data-category="soprano"]').classList.contains('imm-v1__voice-chip--active'),
    ).toBe(false);
  });

  it('sincroniza la voz elegida con SongView vía ctx.setActiveVoice', () => {
    setLayer('tono', true);
    const sv = mountSongView();
    const setActiveVoice = vi.fn();
    enterImmersive(sv, {
      song: buildMultiVoiceSong(),
      getActiveVoice: () => 'soprano-1',
      setActiveVoice,
    });

    document.querySelector('[data-category="tenor"]').click();

    expect(setActiveVoice).toHaveBeenCalledWith('tenor', 'tenor-1');
  });
});

describe('sheet de opciones extendido (MODO/VOZ/AFINADOR)', () => {
  afterEach(() => closeOptionsSheet());

  // Portado de tests/stageMode.test.js (BUG Important, review): cerrar el
  // sheet no debe dejar el chrome oculto aunque hayan pasado >= CONTROLS_HIDE_MS
  // mientras estuvo abierto.
  it('los controles siguen visibles al cerrar el sheet aunque hayan pasado >=3s con el sheet abierto', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const chrome = document.getElementById('imm-chrome');

    document.getElementById('imm-open-options').click();
    vi.advanceTimersByTime(3500); // > CONTROLS_HIDE_MS mientras el sheet está abierto
    closeOptionsSheet();

    expect(chrome.classList.contains('imm-v1__chrome--hidden')).toBe(false);
    vi.useRealTimers();
  });

  it('abre con el grupo MODO (Letra activo) y sin VOZ (letra no la necesita)', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('imm-open-options').click();
    expect(document.querySelector('.osheet [data-mode="letra"].is-active')).toBeTruthy();
    expect(document.querySelector('.osheet [data-voice]')).toBeNull();
  });

  it('cambiar MODO desde el sheet re-renderiza las líneas sin resetear el índice activo', () => {
    const sv = mountSongView();
    setLayer('chords', true);
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.querySelector('#imm-roll .imm-line[data-i="1"]').click(); // activa = 1

    document.getElementById('imm-open-options').click();
    document.querySelector('.osheet [data-mode="letra"]').click();

    const lines = document.querySelectorAll('#imm-roll .imm-line');
    expect(lines[1].classList.contains('imm-line--active')).toBe(true); // índice preservado
    expect(lines[1].innerHTML).toBe(buildLetraLineHTML('Segunda línea'));
  });

  it('A+ del sheet aumenta la escala de fuente, la persiste y recentra el scroll (retargetScroll)', () => {
    // requestAnimationFrame controlado: encolamos los callbacks y los
    // disparamos a mano con flush(), así el orden queda determinista (con un
    // mock que ejecuta el callback sincrónicamente DENTRO de la llamada a
    // rAF, la asignación `s.rafId = requestAnimationFrame(loop)` pisaría el
    // `s.rafId = null` que el propio callback ya escribió).
    let queue = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      queue.push(cb);
      return queue.length;
    });
    const flush = () => {
      const cbs = queue;
      queue = [];
      cbs.forEach((cb) => cb(0));
    };

    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    flush(); // resuelve el loop del retargetScroll inicial de enterImmersive -> spring en reposo
    const callsBeforeFont = rafSpy.mock.calls.length;

    document.getElementById('imm-open-options').click();
    document.querySelector('[data-act="fup"]').click();

    expect(document.querySelector('.imm-v1').style.getPropertyValue('--imm-font-scale')).toBe('1.10');
    expect(Number.parseFloat(localStorage.getItem('hkn-stage-font-scale'))).toBeCloseTo(1.1);
    // El cambio de escala de fuente reflow-ea la altura de las líneas: debe
    // haber reprogramado un nuevo frame de scroll (retargetScroll -> spring
    // reasignado -> startScrollLoop pide un rAF nuevo, ya que el anterior
    // había llegado a reposo).
    expect(rafSpy.mock.calls.length).toBeGreaterThan(callsBeforeFont);

    flush();
    rafSpy.mockRestore();
  });

  it('salir con el sheet abierto no deja un sheet huérfano en el DOM', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('imm-open-options').click();
    expect(document.querySelector('.osheet')).toBeTruthy();

    exitImmersive();
    vi.advanceTimersByTime(250);
    expect(document.querySelector('.osheet')).toBeNull();
    vi.useRealTimers();
  });
});

describe('wake lock', () => {
  it("re-adquiere al volver de background (visibilitychange)", () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();
  });
});

// D3: player sincronizado por timings (flag `immersive_player`). buildSong()
// tiene 3 líneas (i 0,1,2); el hueco entre la línea 1 (2000ms) y la línea 2
// (12000ms) es de 10s > 5s -> interludio (mismo umbral de timingEngine.js).
describe('player sincronizado por timings (flag immersive_player)', () => {
  const readyTimings = () => ({
    audio: { url: 'https://storage.example/full.mp3', durationSec: 20 },
    timings: {
      status: 'ready',
      lines: [
        { i: 0, startMs: 0 },
        { i: 1, startMs: 2000 },
        { i: 2, startMs: 12000 },
      ],
    },
  });

  const enablePlayerFlag = () =>
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');

  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('flag off: nunca hay player bar, sigue en TimerEngine aunque haya timings ready', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-player-slot').hidden).toBe(true);
    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.querySelector('#imm-player-slot audio')).toBeNull();
  });

  it('flag on + timings ready + audio: la barra de player queda visible y oculta el FAB', async () => {
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-player-slot').hidden).toBe(false);
    expect(document.querySelector('#imm-player-slot audio')).toBeTruthy();
    expect(document.getElementById('imm-fab').hidden).toBe(true);
  });

  it("toggle 'Reproducir pista' en el sheet reproduce/pausa el audio", async () => {
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    document.getElementById('imm-open-options').click();
    const toggle = document.querySelector('.osheet [data-act="player-toggle"]');
    expect(toggle.textContent).toBe('Reproducir pista');
    toggle.click();

    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('sin flag/audio/timings el sheet NO muestra el toggle de pista', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('imm-open-options').click();
    expect(document.querySelector('.osheet [data-act="player-toggle"]')).toBeNull();
  });

  it('tap en línea en modo sync busca (audio.currentTime), NO usa goTo directo', async () => {
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    document.querySelector('#imm-roll .imm-line[data-i="2"]').click();

    const audio = document.querySelector('#imm-player-slot audio');
    expect(audio.currentTime).toBe(12); // startMs 12000 -> 12s

    // El highlight de la línea activa NO cambia de forma síncrona con el tap
    // (mismo contrato que timingEngine.seekToLine): sigue en la línea 0 hasta
    // el próximo timeupdate real del audio.
    expect(document.querySelector('#imm-roll .imm-line[data-i="0"]').classList.contains('imm-line--active')).toBe(
      true,
    );
  });

  it("error del <audio> en runtime: toast + cae en caliente a TimerEngine sin salir de la vista", async () => {
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValue(readyTimings());
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    expect(audio).toBeTruthy();

    audio.dispatchEvent(new Event('error'));

    // sigue en la vista, con toast y de vuelta al FAB/TimerEngine
    expect(document.querySelector('.imm-v1')).toBeTruthy();
    expect(document.querySelector('.toast.visible')?.textContent).toBe('No se pudo reproducir la pista de audio');
    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.getElementById('imm-player-slot').hidden).toBe(true);

    // El TimerEngine quedó operativo: avanza solo tras el timeout normal.
    vi.advanceTimersByTime(9000);
    expect(document.querySelector('#imm-roll .imm-line[data-i="1"]').classList.contains('imm-line--active')).toBe(
      true,
    );
    vi.useRealTimers();
  });

  it('interludio (gap>5s) muestra un nodo .imm-interlude entre líneas, que desaparece al entrar la siguiente', async () => {
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 2; // entra a la línea 1 (startMs 2000)
    audio.dispatchEvent(new Event('timeupdate'));
    audio.currentTime = 6; // dentro del hueco 2000->12000 (10s), progreso 0.4
    audio.dispatchEvent(new Event('timeupdate'));

    expect(document.querySelector('#imm-roll .imm-interlude')).toBeTruthy();

    audio.currentTime = 12.1; // entra a la línea 2: el interludio se retira
    audio.dispatchEvent(new Event('timeupdate'));

    expect(document.querySelector('#imm-roll .imm-interlude')).toBeNull();
  });

  it('salir en modo sync pausa el audio y vacía el src', async () => {
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    exitImmersive();

    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    // `audio.src` (IDL) resuelve '' contra la URL del documento -> se
    // comprueba el atributo crudo, que sí queda vacío.
    expect(audio.getAttribute('src')).toBe('');
  });

  it('FAB de pausa (#imm-fab) NO existe/actúa en modo sync: pausa es la del player', async () => {
    isFeatureEnabled.mockImplementation((key) => key === 'voz_tono' || key === 'immersive_player');
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const fab = document.getElementById('imm-fab');
    expect(fab.hidden).toBe(true);
    fab.click(); // togglePause debe ser no-op en modo sync
    expect(document.querySelector('.imm-v1').classList.contains('imm-v1--paused')).toBe(false);
  });

  it('sheet: VELOCIDAD (AUTO-SCROLL) visible en timer, oculta en modo sync', async () => {
    enablePlayerFlag();
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });

    // Aún en timer: el await de getSongAudio no resolvió todavía.
    document.getElementById('imm-open-options').click();
    expect(document.querySelector('.osheet .osheet__h')?.textContent).not.toBe(undefined);
    expect(
      [...document.querySelectorAll('.osheet .osheet__h')].some((h) => h.textContent === 'AUTO-SCROLL'),
    ).toBe(true);
    closeOptionsSheet();

    await flushAsync(); // promueve a sync

    document.getElementById('imm-open-options').click();
    expect(
      [...document.querySelectorAll('.osheet .osheet__h')].some((h) => h.textContent === 'AUTO-SCROLL'),
    ).toBe(false);
  });

  it('scrubber: dispatch de "input" en #imm-player-scrubber asigna audio.currentTime', async () => {
    enablePlayerFlag();
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    const scrubber = document.getElementById('imm-player-scrubber');
    scrubber.value = '7.5';
    scrubber.dispatchEvent(new Event('input'));

    expect(audio.currentTime).toBe(7.5);
  });

  it('timeupdate normal (sin interludio) mueve el highlight a la línea de lineAt', async () => {
    enablePlayerFlag();
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 2.1; // startMs 2000 -> línea 1
    audio.dispatchEvent(new Event('timeupdate'));

    expect(document.querySelector('#imm-roll .imm-line[data-i="1"]').classList.contains('imm-line--active')).toBe(
      true,
    );
    expect(document.querySelector('#imm-roll .imm-line[data-i="0"]').classList.contains('imm-line--active')).toBe(
      false,
    );
  });

  it('seekSyncToLine: línea sin timing propio (mapeo sparse) cae al último timing conocido <= idx', async () => {
    enablePlayerFlag();
    // i=1 no tiene timing propio (p.ej. línea instrumental sin palabras alineadas).
    getSongAudio.mockResolvedValue({
      audio: { url: 'https://storage.example/full.mp3', durationSec: 20 },
      timings: {
        status: 'ready',
        lines: [
          { i: 0, startMs: 500 },
          { i: 2, startMs: 9000 },
        ],
      },
    });
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    document.querySelector('#imm-roll .imm-line[data-i="1"]').click();

    const audio = document.querySelector('#imm-player-slot audio');
    expect(audio.currentTime).toBe(0.5); // cae al timing de i=0 (500ms), el último <= 1
  });

  it('matriz de degradación: flag on sin audio -> sigue en timer (FAB visible, sin player bar)', async () => {
    enablePlayerFlag();
    getSongAudio.mockResolvedValue({ audio: null, timings: { status: 'ready', lines: [{ i: 0, startMs: 0 }] } });
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.getElementById('imm-player-slot').hidden).toBe(true);
  });

  it("matriz de degradación: timings status 'pending' -> sigue en timer", async () => {
    enablePlayerFlag();
    getSongAudio.mockResolvedValue({
      audio: { url: 'https://storage.example/full.mp3', durationSec: 20 },
      timings: { status: 'pending', lines: null },
    });
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.getElementById('imm-player-slot').hidden).toBe(true);
  });

  it("matriz de degradación: timings status 'failed' -> sigue en timer", async () => {
    enablePlayerFlag();
    getSongAudio.mockResolvedValue({
      audio: { url: 'https://storage.example/full.mp3', durationSec: 20 },
      timings: { status: 'failed', lines: null },
    });
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.getElementById('imm-player-slot').hidden).toBe(true);
  });

  it('matriz de degradación: getSongAudio resuelve null -> sigue en timer', async () => {
    enablePlayerFlag();
    getSongAudio.mockResolvedValue(null);
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.getElementById('imm-player-slot').hidden).toBe(true);
  });
});
