import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

// getSongAudio (D3): default null (sin audio/timings) para que ningún test
// preexistente dispare una promoción a sync por accidente; cada test del
// player lo sobreescribe con mockResolvedValueOnce.
vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: vi.fn(() => Promise.resolve(null)),
}));

// createMetronomeClick (F4) usa AudioContext, no disponible en jsdom: mismo
// patrón de stub que el detector de pitch. Cada spy se resetea en el
// beforeEach del describe del metrónomo.
const metronomeSetMuted = vi.fn();
const metronomeIsMuted = vi.fn(() => true);
const metronomeStop = vi.fn();
vi.mock('../src/lib/metronomeClick.js', () => ({
  createMetronomeClick: vi.fn(() => ({
    setMuted: metronomeSetMuted,
    isMuted: metronomeIsMuted,
    stop: metronomeStop,
  })),
}));

import { enterImmersive, exitImmersive } from '../src/components/ImmersiveView.js';
import { setLayer } from '../src/lib/layerStore.js';
import {
  buildLetraLineHTML,
  buildChordsLineHTML,
  buildMixedLineHTML,
} from '../src/lib/lyricsRender.js';
import { closeOptionsSheet } from '../src/components/OptionsSheet.js';
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

  it('la línea SIGUIENTE a la activa queda legible (imm-line--next), no imm-line--d1', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const lines = document.querySelectorAll('#imm-roll .imm-line');
    expect(lines[1].classList.contains('imm-line--next')).toBe(true);
    expect(lines[1].classList.contains('imm-line--d1')).toBe(false);
    expect(lines[2].classList.contains('imm-line--d2')).toBe(true); // futuras ≥2: igual que hoy
  });

  it('la línea ANTERIOR a la activa queda casi nítida (imm-line--prev), no imm-line--d1', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.querySelector('#imm-roll .imm-line[data-i="2"]').click();
    const lines = document.querySelectorAll('#imm-roll .imm-line');
    expect(lines[1].classList.contains('imm-line--prev')).toBe(true);
    expect(lines[1].classList.contains('imm-line--d1')).toBe(false);
    expect(document.querySelectorAll('#imm-roll .imm-line--d1')).toHaveLength(0);
  });

  it('modo letra (default): todas las líneas usan buildLetraLineHTML', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const lines = document.querySelectorAll('#imm-roll .imm-line');
    expect(lines[0].innerHTML).toBe(buildLetraLineHTML('Primera línea'));
    expect(lines[1].innerHTML).toBe(buildLetraLineHTML('Segunda línea'));
  });

  it("modo 'chords': línea activa contiene acordes; la vecina también (atenuada por CSS)", () => {
    // El modo ya no se hereda de las capas de SongView: se persiste la
    // elección hecha en el propio full view (hkn-immersive-mode).
    localStorage.setItem('hkn-immersive-mode', 'chords');
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
    const line0 = {
      text: 'Primera línea',
      groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' }],
    };
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
    localStorage.setItem('hkn-immersive-mode', 'tono');
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
    localStorage.setItem('hkn-immersive-mode', 'tono');
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
    expect(lines[1].classList.contains('imm-line--prev')).toBe(true); // anterior a la activa: casi nítida
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

  it('el panel del afinador va ANTES de la barra inferior en el DOM (queda encima del player, no lo tapa)', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong() });
    const panel = document.getElementById('imm-tuner-panel');
    const bottombar = document.getElementById('imm-bottombar');
    expect(panel.nextElementSibling).toBe(bottombar);
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
      document
        .querySelector('#imm-roll .imm-line[data-i="1"]')
        .classList.contains('imm-line--active'),
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

  it('B8 (perf): swipe vertical NO reconstruye el roll (innerHTML) — solo cambia seconds', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const viewport = document.getElementById('imm-viewport');
    const roll = document.getElementById('imm-roll');
    const lineElsBefore = Array.from(roll.children);

    dispatchPointer(viewport, 'pointerdown', 100, 300);
    dispatchPointer(document, 'pointermove', 100, 200);
    dispatchPointer(document, 'pointerup', 100, 200); // dy=-100 >= 40px: sube velocidad

    // Si recomputeLines/renderRoll corrieran, el roll se reconstruye con
    // innerHTML y los nodos hijos serían instancias NUEVAS (misma referencia
    // != mismo elemento tras un innerHTML rebuild).
    const lineElsAfter = Array.from(roll.children);
    expect(lineElsAfter).toEqual(lineElsBefore);
    lineElsAfter.forEach((el, i) => expect(el).toBe(lineElsBefore[i]));
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
      document
        .querySelector('#imm-roll .imm-line[data-i="0"]')
        .classList.contains('imm-line--active'),
    ).toBe(true); // sin avanzar

    fab.click();
    expect(overlay.classList.contains('imm-v1--paused')).toBe(false);
    vi.advanceTimersByTime(8000);
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="1"]')
        .classList.contains('imm-line--active'),
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
    // La nota solo se pinta en modo tono, así que esta aserción necesita el
    // modo persistido en hkn-immersive-mode para que la nota sea observable.
    localStorage.setItem('hkn-immersive-mode', 'tono');
    const sv = mountSongView();
    enterImmersive(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1' });
    const activeLine = () => document.querySelector('#imm-roll .imm-line[data-i="0"]');
    expect(activeLine().textContent).toContain('C4');

    document.querySelector('[data-category="tenor"]').click();

    expect(document.querySelector('.imm-v1')).toBeTruthy(); // sigue en la vista
    expect(activeLine().textContent).toContain('G3');
    expect(
      document
        .querySelector('[data-category="tenor"]')
        .classList.contains('imm-v1__voice-chip--active'),
    ).toBe(true);
    expect(
      document
        .querySelector('[data-category="soprano"]')
        .classList.contains('imm-v1__voice-chip--active'),
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

  // Bug real cazado por el e2e Playwright contra el preview (tests/e2e/immersive.spec.js):
  // el sheet montaba con un z-index (300/301) por DEBAJO de `.imm-v1`
  // (llegó a 1000/1001), así que cualquier `.imm-line` con transform/filter
  // (stacking context propio) podía interceptar el click de un botón del
  // sheet en el navegador real — invisible para jsdom, que no calcula
  // layout/stacking. jsdom no puede medir el stacking real, pero SÍ puede
  // afirmar la invariante que lo garantiza: el número de z-index de
  // `.imm-v1` en la hoja de estilos debe ser MENOR que el de `.osheet`
  // (options-sheet.css), y el sheet debe montar como hermano de `.imm-v1`
  // en <body> (no anidado dentro del overlay, donde heredaría su stacking
  // context aunque el z-index fuera correcto).
  it('invariante: el overlay inmersivo tiene menor z-index que el sheet de opciones (options-sheet.css)', () => {
    const immersiveCss = readFileSync(resolve(process.cwd(), 'src/styles/immersive.css'), 'utf-8');
    const sheetCss = readFileSync(resolve(process.cwd(), 'src/styles/options-sheet.css'), 'utf-8');

    const immRuleMatch = immersiveCss.match(/\.imm-v1\s*\{[^}]*\}/);
    const osheetRuleMatch = sheetCss.match(/\.osheet\s*\{[^}]*\}/);
    expect(immRuleMatch).not.toBeNull();
    expect(osheetRuleMatch).not.toBeNull();

    const immZIndex = Number(immRuleMatch[0].match(/z-index:\s*(\d+)/)[1]);
    const osheetZIndex = Number(osheetRuleMatch[0].match(/z-index:\s*(\d+)/)[1]);
    expect(osheetZIndex).toBeGreaterThan(immZIndex);
  });

  it('el sheet monta como hermano de .imm-v1 en <body>, no anidado dentro del overlay', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('imm-open-options').click();

    const sheet = document.querySelector('.osheet');
    expect(sheet).toBeTruthy();
    expect(sheet.parentElement).toBe(document.body);
    expect(document.querySelector('.imm-v1 .osheet')).toBeNull(); // NO anidado bajo el overlay
  });

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

    expect(document.querySelector('.imm-v1').style.getPropertyValue('--imm-font-scale')).toBe(
      '1.10',
    );
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
  it('re-adquiere al volver de background (visibilitychange)', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();
  });
});

// D3: player sincronizado por timings. buildSong()
// tiene 3 líneas (i 0,1,2); el hueco entre la línea 1 (2000ms) y la línea 2
// (12000ms) es de 10s > 5s -> interludio (mismo umbral de timingEngine.js).
describe('player sincronizado por timings', () => {
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

  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('timings ready + audio: la barra de player queda visible y el FAB se oculta para siempre (un solo play)', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-player-slot').hidden).toBe(false);
    expect(document.querySelector('#imm-player-slot audio')).toBeTruthy();
    // Con pista disponible hay un solo play: el de la barra. El FAB se oculta
    // al promover, aunque la pista todavía no suene.
    expect(document.getElementById('imm-fab').hidden).toBe(true);
  });

  it("toggle 'Pista: en pausa/sonando' en el sheet reproduce/pausa el audio", async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    document.getElementById('imm-open-options').click();
    const toggle = document.querySelector('.osheet [data-act="player-toggle"]');
    expect(toggle.textContent).toBe('Pista: en pausa');
    toggle.click();

    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('sin audio/timings el sheet NO muestra el toggle de pista', () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('imm-open-options').click();
    expect(document.querySelector('.osheet [data-act="player-toggle"]')).toBeNull();
  });

  it('tap en línea en modo sync busca (audio.currentTime), NO usa goTo directo', async () => {
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
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="0"]')
        .classList.contains('imm-line--active'),
    ).toBe(true);
  });

  it('error del <audio> en runtime: toast + cae en caliente a TimerEngine sin salir de la vista', async () => {
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
    expect(document.querySelector('.toast.visible')?.textContent).toBe(
      'No se pudo reproducir la pista de audio',
    );
    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.getElementById('imm-player-slot').hidden).toBe(true);

    // El TimerEngine quedó operativo: avanza solo tras el timeout normal.
    vi.advanceTimersByTime(9000);
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="1"]')
        .classList.contains('imm-line--active'),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('interludio (gap>5s) muestra un nodo .imm-interlude entre líneas, que desaparece al entrar la siguiente', async () => {
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

  it('pre-roll (intro >= 3s): sin línea activa, la línea 0 en --next, el interludio se pinta antes de la primera línea; al entrar a la línea 0 se retira y anima a activa', async () => {
    getSongAudio.mockResolvedValue({
      audio: { url: 'https://storage.example/full.mp3', durationSec: 20 },
      timings: {
        status: 'ready',
        lines: [
          { i: 0, startMs: 4000 },
          { i: 1, startMs: 6000 },
          { i: 2, startMs: 16000 },
        ],
      },
    });
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 1; // ms=1000+LEAD_MS(120)=1120 < 4000 -> pre-roll (index -1)
    audio.dispatchEvent(new Event('timeupdate'));

    const line0 = document.querySelector('#imm-roll .imm-line[data-i="0"]');
    expect(document.querySelector('#imm-roll .imm-line--active')).toBeNull();
    expect(line0.classList.contains('imm-line--next')).toBe(true);

    const interlude = document.querySelector('#imm-roll .imm-interlude');
    expect(interlude).toBeTruthy();
    expect(interlude.nextElementSibling).toBe(line0);

    audio.currentTime = 4; // ms=4000+120=4120 >= 4000 -> entra a la línea 0
    audio.dispatchEvent(new Event('timeupdate'));

    expect(document.querySelector('#imm-roll .imm-interlude')).toBeNull();
    expect(line0.classList.contains('imm-line--active')).toBe(true);
  });

  it('salir en modo sync pausa el audio y vacía el src', async () => {
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

  it('FAB de pausa: oculto y no-op en sync, esté la pista sonando o pausada', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const fab = document.getElementById('imm-fab');
    const audio = document.querySelector('#imm-player-slot audio');

    // Recién promovido, pista pausada: el FAB ya está oculto y no hace nada.
    expect(fab.hidden).toBe(true);
    expect(document.querySelector('.imm-v1').classList.contains('imm-v1--paused')).toBe(true);
    fab.click();
    expect(document.querySelector('.imm-v1').classList.contains('imm-v1--paused')).toBe(true);

    // Pista sonando: el audio manda; FAB sigue oculto y togglePause no-op.
    audio.dispatchEvent(new Event('play'));
    expect(fab.hidden).toBe(true);
    fab.click();
    expect(document.querySelector('.imm-v1').classList.contains('imm-v1--paused')).toBe(false);
  });

  it('sheet: VELOCIDAD (AUTO-SCROLL) visible mientras conduce el timer, oculta apenas se promueve a sync', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });

    // Aún en timer: el await de getSongAudio no resolvió todavía.
    document.getElementById('imm-open-options').click();
    expect(document.querySelector('.osheet .osheet__h')?.textContent).not.toBe(undefined);
    expect(
      [...document.querySelectorAll('.osheet .osheet__h')].some(
        (h) => h.textContent === 'AUTO-SCROLL',
      ),
    ).toBe(true);
    closeOptionsSheet();

    await flushAsync(); // promueve a sync (timer detenido, pista pausada esperando el play de la barra)

    // El timer ya no conduce en sync (esté sonando o no la pista): la
    // perilla se oculta apenas se promueve, no cuando la pista arranca.
    document.getElementById('imm-open-options').click();
    expect(
      [...document.querySelectorAll('.osheet .osheet__h')].some(
        (h) => h.textContent === 'AUTO-SCROLL',
      ),
    ).toBe(false);
    closeOptionsSheet();

    document.querySelector('#imm-player-slot audio').dispatchEvent(new Event('play'));
    document.getElementById('imm-open-options').click();
    expect(
      [...document.querySelectorAll('.osheet .osheet__h')].some(
        (h) => h.textContent === 'AUTO-SCROLL',
      ),
    ).toBe(false);
  });

  it('scrubber: dispatch de "input" en #imm-player-scrubber asigna audio.currentTime', async () => {
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
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 2.1; // startMs 2000 -> línea 1
    audio.dispatchEvent(new Event('timeupdate'));

    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="1"]')
        .classList.contains('imm-line--active'),
    ).toBe(true);
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="0"]')
        .classList.contains('imm-line--active'),
    ).toBe(false);
  });

  it('seekSyncToLine: línea sin timing propio (mapeo sparse) cae al último timing conocido <= idx', async () => {
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

  it('matriz de degradación: sin audio -> sigue en timer (FAB visible, sin player bar)', async () => {
    getSongAudio.mockResolvedValue({
      audio: null,
      timings: { status: 'ready', lines: [{ i: 0, startMs: 0 }] },
    });
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.getElementById('imm-player-slot').hidden).toBe(true);
  });

  it("matriz de degradación: timings status 'pending' -> sigue en timer", async () => {
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
    getSongAudio.mockResolvedValue(null);
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-fab').hidden).toBe(false);
    expect(document.getElementById('imm-player-slot').hidden).toBe(true);
  });

  it('sheet reabierto tras un fallback a timer vuelve a mostrar VELOCIDAD y esconde PISTA', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.dispatchEvent(new Event('error')); // fuerza el fallback a timer

    document.getElementById('imm-open-options').click();
    expect(
      [...document.querySelectorAll('.osheet .osheet__h')].some(
        (h) => h.textContent === 'AUTO-SCROLL',
      ),
    ).toBe(true);
    expect(document.querySelector('.osheet [data-act="player-toggle"]')).toBeNull();
  });

  // Race exit/re-enter con el fetch de getSongAudio en vuelo (guard `session
  // !== s` de maybeLoadSyncAudio): la promesa se controla a mano vía una
  // referencia al `resolve` capturada en el mock, sin await previo.
  it('race: salir ANTES de que resuelva getSongAudio no crashea ni promueve', async () => {
    let resolveFetch;
    getSongAudio.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });

    exitImmersive(); // sale ANTES de que el fetch resuelva

    expect(() => resolveFetch(readyTimings())).not.toThrow();
    await flushAsync();

    expect(document.querySelector('.imm-v1')).toBeNull(); // sigue afuera, sin overlay huérfano
  });

  it('race: salir y re-entrar -> el fetch VIEJO no promueve la sesión NUEVA (guard session !== s)', async () => {
    let resolveFirst;
    getSongAudio.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    exitImmersive();

    // Segunda sesión: su propio fetch queda deliberadamente pendiente (no se
    // resuelve en este test) — lo único que se resuelve es el de la primera.
    getSongAudio.mockImplementation(() => new Promise(() => {}));
    const sv2 = mountSongView();
    enterImmersive(sv2, { song: buildSong(), getActiveVoice: () => 'soprano-1' });

    resolveFirst(readyTimings());
    await flushAsync();

    expect(document.getElementById('imm-player-slot').hidden).toBe(true);
    expect(document.getElementById('imm-fab').hidden).toBe(false);
  });

  it('promovido a sync sin dar play: el timer queda detenido, la letra no avanza sola', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-player-slot').hidden).toBe(false);
    vi.advanceTimersByTime(20000);
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="0"]')
        .classList.contains('imm-line--active'),
    ).toBe(true);
    vi.useRealTimers();
  });

  it("'play'/'pause' de la pista pausan y reanudan TODO; el FAB nunca reaparece (un solo play)", async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    const fab = document.getElementById('imm-fab');
    expect(fab.hidden).toBe(true);

    audio.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(20000); // el timer NO avanza: manda el audio
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="0"]')
        .classList.contains('imm-line--active'),
    ).toBe(true);

    audio.dispatchEvent(new Event('pause'));
    expect(fab.hidden).toBe(true); // sigue oculto: no hay segundo play
    expect(document.querySelector('.imm-v1').classList.contains('imm-v1--paused')).toBe(true);
    vi.advanceTimersByTime(20000); // pausado: sigue sin avanzar, el timer nunca retoma
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="0"]')
        .classList.contains('imm-line--active'),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('al entrar en sync la pista arranca muteada', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    const muteBtn = document.getElementById('imm-player-mute');
    expect(audio.muted).toBe(true);
    expect(muteBtn.getAttribute('aria-pressed')).toBe('true');
    expect(muteBtn.getAttribute('aria-label')).toBe('Activar sonido de la pista');
  });

  it('el botón de altavoz silencia/activa la pista (muted) sin pausarla', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    const muteBtn = document.getElementById('imm-player-mute');
    expect(muteBtn).toBeTruthy();
    // Default: pista muteada al entrar (spec).
    expect(audio.muted).toBe(true);

    muteBtn.click();
    expect(audio.muted).toBe(false);
    expect(muteBtn.getAttribute('aria-pressed')).toBe('false');

    muteBtn.click();
    expect(audio.muted).toBe(true);
    expect(muteBtn.getAttribute('aria-pressed')).toBe('true');
    // Silenciar no pausa: la vista arranca en pausa (nadie dio play todavía
    // en este test) igual que antes de tocar el mute — el mute no la altera.
    expect(document.querySelector('.imm-v1').classList.contains('imm-v1--paused')).toBe(true);
  });

  it('barra y sheet sincronizados: el altavoz de la barra refleja #osheet-track-sound y viceversa', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const muteBtn = document.getElementById('imm-player-mute');
    document.getElementById('imm-open-options').click();
    const sheetBtn = document.getElementById('osheet-track-sound');
    expect(sheetBtn).toBeTruthy();
    // Default muteado -> "silenciada" (aria-pressed false = no activada).
    expect(sheetBtn.getAttribute('aria-pressed')).toBe('false');

    muteBtn.click(); // desmutea
    expect(document.getElementById('osheet-track-sound').getAttribute('aria-pressed')).toBe(
      'true',
    );

    document.getElementById('osheet-track-sound').click(); // vuelve a mutear
    expect(muteBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('independencia: mutear la pista no llama a metronomeSetMuted (canales separados)', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    metronomeSetMuted.mockClear();
    const muteBtn = document.getElementById('imm-player-mute');
    muteBtn.click();
    expect(metronomeSetMuted).not.toHaveBeenCalled();
  });

  it('seek con la pista pausada: el highlight llega vía timeupdate, el timer NUNCA retoma en sync', async () => {
    getSongAudio.mockResolvedValue(readyTimings());
    vi.useFakeTimers();
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 2.1; // startMs 2000 -> línea 1
    audio.dispatchEvent(new Event('timeupdate'));
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="1"]')
        .classList.contains('imm-line--active'),
    ).toBe(true);

    // La pista sigue pausada: en sync el timer nunca conduce, así que no hay
    // avance por más que pase el tiempo (a diferencia del modo timer puro).
    vi.advanceTimersByTime(20000);
    expect(
      document
        .querySelector('#imm-roll .imm-line[data-i="1"]')
        .classList.contains('imm-line--active'),
    ).toBe(true);
    vi.useRealTimers();
  });
});

// F4: metrónomo en la vista inmersiva (badge BPM, pulso, count-in por beats,
// click con mute propio). Reusa el mismo fixture de 3 líneas (D3) + agrega
// `timings.beats` (endpoint expone beats + overrides de bpm/compas/ancla).
describe('metrónomo (badge BPM, pulso, count-in, click)', () => {
  // 120 BPM (500ms/beat), 0..12000ms — cubre el hueco 2000->12000 del fixture.
  const BEATS_MS = Array.from({ length: 25 }, (_, i) => i * 500);

  const readyTimingsWithBeats = (overrides = {}) => ({
    audio: {
      url: 'https://storage.example/full.mp3',
      durationSec: 20,
      ...(overrides.audio || {}),
    },
    timings: {
      status: 'ready',
      lines: [
        { i: 0, startMs: 0 },
        { i: 1, startMs: 2000 },
        { i: 2, startMs: 12000 },
      ],
      beats: overrides.beats ?? BEATS_MS,
      bpmDetected: overrides.bpmDetected ?? 112.35,
    },
  });

  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    metronomeSetMuted.mockClear();
    metronomeIsMuted.mockClear();
    metronomeStop.mockClear();
  });

  it('sin beat grid (timings.lines sin beats): badge y pulso siguen hidden', async () => {
    getSongAudio.mockResolvedValue({
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
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-bpm-badge').hidden).toBe(true);
    expect(document.getElementById('imm-pulse').hidden).toBe(true);
  });

  it('con beats + ready: badge "112 BPM · 4/4" y pulso con perBar puntos visibles', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const badge = document.getElementById('imm-bpm-badge');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('112 BPM · 4/4');
    const pulse = document.getElementById('imm-pulse');
    expect(pulse.hidden).toBe(false);
    expect(pulse.querySelectorAll('.imm-v1__pulse-dot').length).toBe(4);
  });

  it('con audio.bpmManual: el badge usa el bpm manual, no el detectado', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats({ audio: { bpmManual: 90 } }));
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-bpm-badge').textContent).toBe('90 BPM · 4/4');
  });

  it('con beats pero bpm nulo (sin bpmDetected ni bpmManual): badge sigue hidden, pulso visible', async () => {
    // No se usa el helper readyTimingsWithBeats: su `overrides.bpmDetected ?? 112.35`
    // trata `null` como nullish y cae al default, precisamente el caso que
    // este test necesita evitar.
    getSongAudio.mockResolvedValue({
      audio: { url: 'https://storage.example/full.mp3', durationSec: 20 },
      timings: {
        status: 'ready',
        lines: [
          { i: 0, startMs: 0 },
          { i: 1, startMs: 2000 },
          { i: 2, startMs: 12000 },
        ],
        beats: BEATS_MS,
        bpmDetected: null,
      },
    });
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    expect(document.getElementById('imm-bpm-badge').hidden).toBe(true);
    expect(document.getElementById('imm-pulse').hidden).toBe(false);
  });

  // D6: el count-in se acota al último compás (`1 <= remainingBeats <= perBar`).
  // El viejo test "gap < 2 beats muestra puntos" (removido) usaba el mismo
  // target `nextLine.startMs=12000` que estos casos, que cae EXACTO sobre
  // `beatsMs[24]=12000` (rejilla alineada a la línea); con esos números,
  // `remainingBeats` resolvía a 1 justo antes de la línea 2 — y bajo el
  // nuevo spec `remainingBeats=1` DEBE mostrar el contador "1" (caso cubierto
  // abajo), no puntos. El test viejo quedó en conflicto directo con el
  // comportamiento pedido, no con un supuesto invariante de que
  // `remainingBeats` nunca baja de 1: esa cota solo se cumple cuando
  // `nextLine.startMs` coincide con un punto de la rejilla, como en este
  // fixture. En producción los beats se detectan independientes del timing
  // de las líneas, así que un `startMs` no alineado a la rejilla SÍ puede
  // dar `remainingBeats=0` dentro de un hueco (ver el test de blindaje más
  // abajo) — por eso el test viejo se reemplazó, no se eliminó una cobertura.
  it('count-in acotado: faltando 12 beats (> perBar=4) se muestran puntos, no el contador', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 2;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.currentTime = 6; // faltan ~6s = 12 beats para la línea 2 (12000ms), > perBar
    audio.dispatchEvent(new Event('timeupdate'));

    expect(document.querySelector('#imm-roll .imm-interlude__count')).toBeNull();
    expect(document.querySelectorAll('#imm-roll .imm-interlude__dot').length).toBe(3);
  });

  it('count-in acotado: faltando exactamente perBar (4) beats aparece .imm-interlude__count "4"', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 2;
    audio.dispatchEvent(new Event('timeupdate'));
    // remainingBeats se calcula sin LEAD_MS (solo `showInterlude`, no `lineAt`):
    // ms=10000 -> indexAt=20 (beatsMs[20]=10000). beatsUntil(10000,12000) = 24-20 = 4, == perBar.
    audio.currentTime = 10;
    audio.dispatchEvent(new Event('timeupdate'));

    const count = document.querySelector('#imm-roll .imm-interlude__count');
    expect(count).toBeTruthy();
    expect(count.textContent).toBe('4');
  });

  it('count-in acotado: faltando 1 beat muestra .imm-interlude__count "1"', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 2;
    audio.dispatchEvent(new Event('timeupdate'));
    // ms=11500 -> indexAt=23 (beatsMs[23]=11500). beatsUntil(11500,12000) = 24-23 = 1.
    audio.currentTime = 11.5;
    audio.dispatchEvent(new Event('timeupdate'));

    const count = document.querySelector('#imm-roll .imm-interlude__count');
    expect(count).toBeTruthy();
    expect(count.textContent).toBe('1');
  });

  it('count-in acotado: remainingBeats=0 (línea NO alineada a la rejilla de beats) muestra puntos, no el contador', async () => {
    // La línea 2 arranca en 12200ms, fuera de la rejilla de beats (que
    // termina en beatsMs[24]=12000): tanto `indexAt(12000)` como
    // `indexAt(12200)` resuelven al mismo índice 24, así que
    // `beatsUntil(12000, 12200)` da 0 de forma genuina (derivado del
    // fixture, no mockeado a mano) — el caso real de producción donde el
    // beat-tracking no cae justo sobre el `startMs` de la línea.
    getSongAudio.mockResolvedValue({
      audio: { url: 'https://storage.example/full.mp3', durationSec: 20 },
      timings: {
        status: 'ready',
        lines: [
          { i: 0, startMs: 0 },
          { i: 1, startMs: 2000 },
          { i: 2, startMs: 12200 },
        ],
        beats: BEATS_MS,
        bpmDetected: 112.35,
      },
    });
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    audio.currentTime = 2;
    audio.dispatchEvent(new Event('timeupdate'));
    // ms=12000 (sin LEAD_MS, showInterlude usa currentTime crudo) -> remainingBeats=0.
    // Con LEAD_MS (120, solo dentro de timingEngine) el motor sigue viendo
    // 12120 < next.startMs(12200): la línea 2 todavía no arrancó.
    audio.currentTime = 12;
    audio.dispatchEvent(new Event('timeupdate'));

    expect(document.querySelector('#imm-roll .imm-interlude__count')).toBeNull();
    expect(document.querySelectorAll('#imm-roll .imm-interlude__dot').length).toBe(3);
  });

  it('sheet: showMetronome pinta la sección y el toggle de sonido dispara onMetronomeAudioToggle (setMuted)', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    document.getElementById('imm-open-options').click();
    const toggle = document.querySelector('.osheet [data-act="metronome-audio-toggle"]');
    expect(toggle).toBeTruthy();
    // Split F4/TANDA B: audio arranca apagado al entrar.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();

    expect(metronomeSetMuted).toHaveBeenCalledWith(false);
  });

  it('sheet: el toggle VISUAL arranca encendido y dispara onMetronomeVisualToggle', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    document.getElementById('imm-open-options').click();
    const toggle = document.querySelector('.osheet [data-act="metronome-visual-toggle"]');
    expect(toggle).toBeTruthy();
    // Split F4/TANDA B: visual arranca encendido al entrar.
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    metronomeSetMuted.mockClear(); // aísla del setMuted disparado por el mount
    toggle.click();

    expect(document.getElementById('imm-pulse').hidden).toBe(true);
    expect(document.getElementById('imm-bpm-badge').hidden).toBe(true);
    // Minor del reviewer: el toggle VISUAL no toca el eje de sonido del
    // metrónomo (canales independientes).
    expect(metronomeSetMuted).not.toHaveBeenCalled();
    expect(document.getElementById('imm-metronome-toggle').getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('independencia: togglear el sonido del metrónomo no muta audio.muted de la pista', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const audio = document.querySelector('#imm-player-slot audio');
    const mutedBefore = audio.muted;
    document.getElementById('imm-open-options').click();
    document.getElementById('osheet-metronome-audio').click();
    expect(audio.muted).toBe(mutedBefore);
  });

  it('sheet: el toggle de sonido también refleja el estado en el toggle rápido de la barra (mismo setMetronomeAudioOn)', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const quickToggle = document.getElementById('imm-metronome-toggle');
    // Split F4/TANDA B: audio arranca apagado al entrar.
    expect(quickToggle.getAttribute('aria-pressed')).toBe('false');

    document.getElementById('imm-open-options').click();
    const sheetToggle = document.querySelector('.osheet [data-act="metronome-audio-toggle"]');
    sheetToggle.click();
    expect(quickToggle.getAttribute('aria-pressed')).toBe('true');

    document.getElementById('imm-open-options').click();
    document.querySelector('.osheet [data-act="metronome-audio-toggle"]').click();
    expect(quickToggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('sheet: sin beat grid, METRÓNOMO no aparece', async () => {
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('imm-open-options').click();
    expect(document.querySelector('.osheet [data-act="metronome-audio-toggle"]')).toBeNull();
    expect(document.querySelector('.osheet [data-act="metronome-visual-toggle"]')).toBeNull();
  });

  it('toggle rápido en la barra de player: existe con beat grid, arranca apagado (split F4/TANDA B), un clic lo enciende (setMuted(false))', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    const quickToggle = document.getElementById('imm-metronome-toggle');
    expect(quickToggle).toBeTruthy();
    expect(quickToggle.getAttribute('aria-label')).toBe('Sonido del metrónomo');
    // Split F4/TANDA B: audio arranca apagado al entrar.
    expect(quickToggle.getAttribute('aria-pressed')).toBe('false');

    quickToggle.click();
    expect(metronomeSetMuted).toHaveBeenCalledWith(false);
    expect(quickToggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('salir de la vista inmersiva detiene el click del metrónomo (stop)', async () => {
    getSongAudio.mockResolvedValue(readyTimingsWithBeats());
    const sv = mountSongView();
    enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    await flushAsync();

    exitImmersive();
    expect(metronomeStop).toHaveBeenCalled();
  });

  describe('pulso rAF (startPulseLoop/stopPulseLoop)', () => {
    // rAF controlado: encolamos el callback y lo disparamos a mano (mismo
    // patrón que "A+ del sheet..." arriba) — startPulseLoop se reprograma a
    // sí mismo cada frame, así que un mock síncrono looparía infinito. El
    // spy se instala DESPUÉS de enterImmersive+flushAsync (no en un
    // beforeEach del describe): el rollo también tiene su propio rAF
    // (retargetScroll) que si no, contaminaría la cola antes de que el
    // audio dispare `play`.
    async function enterWithBeats() {
      getSongAudio.mockResolvedValue(readyTimingsWithBeats());
      const sv = mountSongView();
      enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
      await flushAsync();
      const queue = [];
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        queue.push(cb);
        return queue.length;
      });
      const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
      return { audio: document.querySelector('#imm-player-slot audio'), queue, rafSpy, cafSpy };
    }

    it('play + un frame en beat 1 (ms=0): el dot 1 queda is-active e is-accent', async () => {
      const { audio, queue, rafSpy, cafSpy } = await enterWithBeats();

      audio.currentTime = 0; // beatIndex 0 -> beatInBar 1 (acento)
      audio.dispatchEvent(new Event('play'));
      // 2 frames en cola: timingEngine.attach() registra su listener 'play'
      // antes que el toggle del pulso (mountPlayerBar corre después de
      // promoteToSync), así que su rAF de sync de letra encola primero.
      expect(queue.length).toBe(2);
      queue.shift(); // descarta el frame de timingEngine, ajeno a este test
      queue.shift()(0); // ejecuta el frame del pulso

      const dots = document.querySelectorAll('#imm-pulse .imm-v1__pulse-dot');
      expect(dots[0].classList.contains('is-active')).toBe(true);
      expect(dots[0].classList.contains('is-accent')).toBe(true);
      expect(dots[1].classList.contains('is-active')).toBe(false);
      expect(dots[2].classList.contains('is-active')).toBe(false);
      expect(dots[3].classList.contains('is-active')).toBe(false);

      rafSpy.mockRestore();
      cafSpy.mockRestore();
    });

    it('play + un frame en beat 3 (ms=1000): el dot 3 queda is-active sin is-accent', async () => {
      const { audio, queue, rafSpy, cafSpy } = await enterWithBeats();

      audio.currentTime = 1; // beatIndex 2 (beatsMs[2]=1000) -> beatInBar 3
      audio.dispatchEvent(new Event('play'));
      queue.shift(); // descarta el frame de timingEngine
      queue.shift()(0);

      const dots = document.querySelectorAll('#imm-pulse .imm-v1__pulse-dot');
      expect(dots[2].classList.contains('is-active')).toBe(true);
      expect(dots[2].classList.contains('is-accent')).toBe(false);
      expect(dots[0].classList.contains('is-active')).toBe(false);

      rafSpy.mockRestore();
      cafSpy.mockRestore();
    });

    it('pause cancela el loop (cancelAnimationFrame) y no deja el siguiente frame pintando', async () => {
      const { audio, queue, rafSpy, cafSpy } = await enterWithBeats();

      audio.dispatchEvent(new Event('play'));
      expect(queue.length).toBe(2); // frame de timingEngine + frame del pulso
      queue.shift(); // descarta el frame de timingEngine
      queue.shift()(0); // el loop del pulso pide su siguiente frame
      expect(queue.length).toBe(1);

      audio.dispatchEvent(new Event('pause'));
      expect(cafSpy).toHaveBeenCalled();

      // El frame que había quedado pendiente antes del pause ya no debe
      // seguir pintando dots: stopPulseLoop no vacía la cola del rAF real
      // (el navegador cancela por id), aquí lo simulamos vaciándola a mano y
      // confirmando que un nuevo play arranca un loop limpio (timingEngine +
      // pulso, un frame cada uno).
      queue.length = 0;
      audio.dispatchEvent(new Event('play'));
      expect(queue.length).toBe(2);

      rafSpy.mockRestore();
      cafSpy.mockRestore();
    });
  });

  // Task 3.1: con el sheet ABIERTO, un cambio de estado disparado desde
  // FUERA del sheet (toggle rápido, X propia del afinador, play/pausa físico
  // del audio, chip de voz) debe reflejarse al instante en el sheet — mismo
  // patrón que `applyMode` ya usa (`isOptionsSheetOpen() -> openOptions(s)`).
  // Con el sheet CERRADO, ninguno de esos caminos debe abrirlo.
  describe('refreshOptionsSheet: el sheet abierto refleja cambios hechos desde fuera', () => {
    it('metrónomo: el toggle rápido (audio) con el sheet abierto refresca #osheet-metronome-audio', async () => {
      getSongAudio.mockResolvedValue(readyTimingsWithBeats());
      const sv = mountSongView();
      enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
      await flushAsync();

      document.getElementById('imm-open-options').click();
      // Split F4/TANDA B: audio arranca apagado al entrar.
      expect(document.getElementById('osheet-metronome-audio').getAttribute('aria-pressed')).toBe(
        'false',
      );

      document.getElementById('imm-metronome-toggle').click();

      expect(document.getElementById('osheet-metronome-audio').getAttribute('aria-pressed')).toBe(
        'true',
      );
    });

    it('afinador: el toggle rápido y la X propia del widget refrescan #osheet-tuner con el sheet abierto', () => {
      const sv = mountSongView();
      enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });

      document.getElementById('imm-tuner-toggle').click(); // arranca el mic, sheet aún cerrado
      document.getElementById('imm-open-options').click();
      expect(document.getElementById('osheet-tuner').getAttribute('aria-pressed')).toBe('true');

      document.getElementById('imm-tuner-toggle').click(); // apaga vía toggle rápido
      expect(document.getElementById('osheet-tuner').getAttribute('aria-pressed')).toBe('false');

      document.getElementById('imm-tuner-toggle').click(); // reabre
      document.getElementById('imm-open-options').click();
      expect(document.getElementById('osheet-tuner').getAttribute('aria-pressed')).toBe('true');

      // onClose del FloatingTuner pone s.tunerOn=false directo (sin pasar por
      // setTunerOn) — también debe refrescar el sheet.
      document.querySelector('[aria-label="Cerrar afinador"]').click();
      expect(document.getElementById('osheet-tuner').getAttribute('aria-pressed')).toBe('false');
    });

    it('player: play/pause físico del audio refresca #osheet-player con el sheet abierto', async () => {
      getSongAudio.mockResolvedValue(readyTimingsWithBeats());
      const sv = mountSongView();
      enterImmersive(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
      await flushAsync();

      const audio = document.querySelector('#imm-player-slot audio');
      document.getElementById('imm-open-options').click();
      expect(document.getElementById('osheet-player').getAttribute('aria-pressed')).toBe('false');

      audio.dispatchEvent(new Event('play'));
      expect(document.getElementById('osheet-player').getAttribute('aria-pressed')).toBe('true');

      audio.dispatchEvent(new Event('pause'));
      expect(document.getElementById('osheet-player').getAttribute('aria-pressed')).toBe('false');
    });

    it('voz: elegir una voz distinta desde el chip de FUERA del sheet refresca la sección VOZ del sheet abierto', () => {
      // El propio OptionsSheet ya actualiza su DOM al hacer click en un
      // data-voice interno (optimista, sin pasar por ImmersiveView) — esto
      // NO prueba el refresh de Task 3.1. La ruta real que sí lo necesita es
      // el chip #imm-voice-chips, que vive FUERA del sheet.
      localStorage.setItem('hkn-immersive-mode', 'mixed');
      const sv = mountSongView();
      enterImmersive(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1' });

      document.getElementById('imm-open-options').click();
      expect(document.querySelector('.osheet [data-voice="soprano"]').getAttribute('aria-pressed')).toBe(
        'true',
      );

      document.querySelector('[data-category="tenor"]').click();

      expect(document.querySelector('.osheet [data-voice="tenor"]').getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(document.querySelector('.osheet [data-voice="soprano"]').getAttribute('aria-pressed')).toBe(
        'false',
      );
    });

    it('con el sheet CERRADO, ninguno de esos caminos lo abre', async () => {
      getSongAudio.mockResolvedValue(readyTimingsWithBeats());
      localStorage.setItem('hkn-immersive-mode', 'mixed');
      const sv = mountSongView();
      enterImmersive(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1' });
      await flushAsync();

      const audio = document.querySelector('#imm-player-slot audio');
      expect(document.querySelector('.osheet')).toBeNull();

      document.getElementById('imm-metronome-toggle').click();
      expect(document.querySelector('.osheet')).toBeNull();

      document.getElementById('imm-tuner-toggle').click();
      expect(document.querySelector('.osheet')).toBeNull();
      document.querySelector('[aria-label="Cerrar afinador"]').click();
      expect(document.querySelector('.osheet')).toBeNull();

      audio.dispatchEvent(new Event('play'));
      expect(document.querySelector('.osheet')).toBeNull();
      audio.dispatchEvent(new Event('pause'));
      expect(document.querySelector('.osheet')).toBeNull();

      document.querySelector('[data-category="tenor"]').click();
      expect(document.querySelector('.osheet')).toBeNull();
    });
  });
});
