import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub pitch detector (requiere AudioContext/getUserMedia, no disponible en jsdom).
// Mismo patrón que tests/tuner.test.js: el afinador embebido (F3) crea el
// detector recién al activarse el toggle, así que basta un stub inerte.
const detectorStart = vi.fn();
const detectorStop = vi.fn();
vi.mock('../src/lib/pitch.js', () => ({
  createPitchDetector: vi.fn(() => ({
    start: detectorStart,
    stop: detectorStop,
    isRunning: () => false,
  })),
}));

// Stub authStore (requiere supabase.js/router.js) — mismo patrón que
// tests/songViewStageWiring.test.js. 'voz_tono' siempre on para poder probar
// el toggle #stage-layer-tono sin depender del catálogo real de flags.
vi.mock('../src/lib/authStore.js', () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

import {
  enterStage,
  exitStage,
  projectLines,
  speedToSecondsPerLine,
} from '../src/components/StageMode.js';
import { getLayers, setLayer } from '../src/lib/layerStore.js';
import { buildLetraLineHTML, buildChordsLineHTML, buildTonoLineHTML } from '../src/lib/lyricsRender.js';
import { closeOptionsSheet } from '../src/components/OptionsSheet.js';

function mountSongView() {
  document.body.innerHTML = `<div class="song-view" id="sv"></div>`;
  return document.getElementById('sv');
}

function dispatchPointer(el, type, x, y) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y }));
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
          { text: 'Nota de ambiente', annotation: true },
          {
            text: 'Segunda línea',
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'D4' }],
          },
          {
            text: 'Hablado sin nota',
            spoken: true,
            groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'E4' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  exitStage(); // limpia estado entre tests
  document.body.innerHTML = '';
  document.body.className = '';
  localStorage.clear();
  detectorStart.mockClear();
  detectorStop.mockClear();
});

afterEach(() => {
  exitStage();
});

describe('speedToSecondsPerLine', () => {
  it('mapea velocidad mínima a la duración lenta y máxima a la rápida', () => {
    expect(speedToSecondsPerLine(0.01)).toBeCloseTo(9);
    expect(speedToSecondsPerLine(2.0)).toBeCloseTo(2.5);
  });

  it('es monótona decreciente entre los extremos', () => {
    expect(speedToSecondsPerLine(0.5)).toBeGreaterThan(speedToSecondsPerLine(1.5));
  });
});

describe('projectLines', () => {
  it('aplana las secciones y salta las líneas annotation', () => {
    const lines = projectLines(buildSong());
    expect(lines).toHaveLength(3); // 4 líneas - 1 annotation
    expect(lines.every((l) => l.text !== 'Nota de ambiente')).toBe(true);
  });

  it('sin voz activa no hay nota, solo texto/acordes', () => {
    const lines = projectLines(buildSong());
    expect(lines[0].note).toBeNull();
    expect(lines[0].chords).toEqual(['C']);
  });

  it('con voz activa, toma la primera nota de esa voz en la línea', () => {
    const lines = projectLines(buildSong(), { getActiveVoice: () => 'soprano-1' });
    expect(lines[0].note).toBe('C4');
    expect(lines[1].note).toBe('D4');
  });

  it('transpone la nota según getTranspose', () => {
    const lines = projectLines(buildSong(), {
      getActiveVoice: () => 'soprano-1',
      getTranspose: () => ({ semitones: 2, useFlats: false }),
    });
    expect(lines[0].note).toBe('D4');
  });

  it('respeta la notación latina en displayNote', () => {
    const lines = projectLines(buildSong(), {
      getActiveVoice: () => 'soprano-1',
      getNotation: () => 'latin',
    });
    expect(lines[0].note).toBe('Do4');
  });

  it('las líneas spoken no muestran nota aunque haya voz activa', () => {
    const lines = projectLines(buildSong(), { getActiveVoice: () => 'soprano-1' });
    const spokenLine = lines.find((l) => l.spoken);
    expect(spokenLine.note).toBeNull();
  });

  it('T6: conserva chords[] crudos (chordsRaw) y TODAS las notas por sílaba (groups), no solo la primera', () => {
    const song = buildSong({
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
                { start: 8, end: 13, voiceId: 'soprano-1', note: 'D4' },
              ],
            },
          ],
        },
      ],
    });
    const lines = projectLines(song, { getActiveVoice: () => 'soprano-1' });
    expect(lines[0].chordsRaw).toEqual([{ pos: 0, ch: 'C' }]);
    expect(lines[0].groups).toHaveLength(2);
    expect(lines[0].groups.map((g) => g.note)).toEqual(['C4', 'D4']);
    // El campo `note` (chip compacto, compat) sigue siendo solo la primera.
    expect(lines[0].note).toBe('C4');
  });
});

describe('enterStage/exitStage', () => {
  it('no hace nada sin ctx.song', () => {
    const sv = mountSongView();
    enterStage(sv);
    expect(document.querySelector('.stage-v2')).toBeNull();
  });

  it('entra y monta el overlay con la primera línea proyectada', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    expect(sv.classList.contains('song-view--stage')).toBe(true);
    expect(document.body.classList.contains('stage-active')).toBe(true);
    const overlay = document.querySelector('.stage-v2');
    expect(overlay).toBeTruthy();
    expect(document.getElementById('stage-v2-text').textContent).toBe('Primera línea');
    expect(document.getElementById('stage-v2-prev-line').textContent).toBe('');
    expect(document.getElementById('stage-v2-section').textContent).toBe('Verso 1');
  });

  it('prev/next actualizan las 3 zonas y el botón prev se deshabilita al inicio', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const nextBtn = document.getElementById('stage-v2-next');
    const prevBtn = document.getElementById('stage-v2-prev');
    expect(prevBtn.disabled).toBe(true);

    nextBtn.click();
    expect(document.getElementById('stage-v2-text').textContent).toBe('Segunda línea');
    expect(document.getElementById('stage-v2-prev-line').textContent).toBe('Primera línea');
    expect(prevBtn.disabled).toBe(false);

    prevBtn.click();
    expect(document.getElementById('stage-v2-text').textContent).toBe('Primera línea');
  });

  it('tap en el area central (controles visibles) pausa/reanuda el avance automático', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const overlay = document.querySelector('.stage-v2');
    const tapArea = document.getElementById('stage-v2-tap');
    const controls = document.getElementById('stage-v2-controls');
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false); // parte de controles visibles

    tapArea.click(); // controles visibles → pausa
    expect(overlay.classList.contains('stage-v2--paused')).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(document.getElementById('stage-v2-text').textContent).toBe('Primera línea'); // sin avanzar

    // FIX finding C: en pausa los controles quedan FIJOS (sin auto-ocultado) —
    // el próximo tap, con los controles ya visibles, reanuda directo.
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false);
    tapArea.click(); // controles ya visibles → reanuda
    expect(overlay.classList.contains('stage-v2--paused')).toBe(false);
    vi.advanceTimersByTime(8000); // > 7.4s (velocidad default 0.5) pero < 2 intervalos
    expect(document.getElementById('stage-v2-text').textContent).toBe('Segunda línea');
    vi.useRealTimers();
  });

  it('avanza sola tras el intervalo de la sección', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    vi.advanceTimersByTime(8000); // > 7.4s (velocidad default 0.5) pero < 2 intervalos
    expect(document.getElementById('stage-v2-text').textContent).toBe('Segunda línea');
    vi.useRealTimers();
  });

  it('el botón salir cierra el escenario', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    document.getElementById('stage-exit').click();
    expect(document.querySelector('.stage-v2')).toBeNull();
  });

  it('exit deshace todo, limpia el timer y es idempotente', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    exitStage();
    expect(document.querySelector('.stage-v2')).toBeNull();
    expect(sv.classList.contains('song-view--stage')).toBe(false);
    expect(document.body.classList.contains('stage-active')).toBe(false);

    // El timer de avance no debe seguir vivo tras salir (no crashea, no hay overlay que actualizar).
    expect(() => vi.advanceTimersByTime(60000)).not.toThrow();
    expect(() => exitStage()).not.toThrow(); // segunda vez: no-op
    vi.useRealTimers();
  });

  it('Escape sale del escenario', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.stage-v2')).toBeNull();
  });
});

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
          { text: 'Nota de ambiente', annotation: true },
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

describe('gestos (swipe vertical/horizontal, tap vs swipe)', () => {
  it('swipe vertical hacia arriba aumenta la velocidad, persiste y muestra feedback', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const tapArea = document.getElementById('stage-v2-tap');
    const feedback = document.getElementById('stage-v2-feedback');

    dispatchPointer(tapArea, 'pointerdown', 100, 300);
    dispatchPointer(document, 'pointermove', 100, 200);
    dispatchPointer(document, 'pointerup', 100, 200); // dy=-100 (arriba) >= 40px

    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toMatch(/Velocidad/);
    const stored = Number.parseFloat(localStorage.getItem('hkn-autoscroll-speed:song-1'));
    expect(stored).toBeGreaterThan(0.5); // default
  });

  it('swipe vertical hacia abajo reduce la velocidad', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const tapArea = document.getElementById('stage-v2-tap');

    dispatchPointer(tapArea, 'pointerdown', 100, 200);
    dispatchPointer(document, 'pointermove', 100, 300);
    dispatchPointer(document, 'pointerup', 100, 300); // dy=+100 (abajo) >= 40px

    const stored = Number.parseFloat(localStorage.getItem('hkn-autoscroll-speed:song-1'));
    expect(stored).toBeLessThan(0.5);
  });

  it('swipe horizontal hacia la izquierda avanza a la línea siguiente', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const tapArea = document.getElementById('stage-v2-tap');

    dispatchPointer(tapArea, 'pointerdown', 300, 300);
    dispatchPointer(document, 'pointermove', 200, 300);
    dispatchPointer(document, 'pointerup', 200, 300); // dx=-100 >= 40px

    expect(document.getElementById('stage-v2-text').textContent).toBe('Segunda línea');
  });

  it('swipe horizontal hacia la derecha retrocede a la línea anterior', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const tapArea = document.getElementById('stage-v2-tap');
    // Primero avanza una línea para tener a dónde retroceder.
    document.getElementById('stage-v2-next').click();
    expect(document.getElementById('stage-v2-text').textContent).toBe('Segunda línea');

    dispatchPointer(tapArea, 'pointerdown', 200, 300);
    dispatchPointer(document, 'pointermove', 300, 300);
    dispatchPointer(document, 'pointerup', 300, 300); // dx=+100 >= 40px

    expect(document.getElementById('stage-v2-text').textContent).toBe('Primera línea');
  });

  it('un tap corto (<10px) no dispara swipe y sigue pausando via click', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const tapArea = document.getElementById('stage-v2-tap');
    const overlay = document.querySelector('.stage-v2');

    dispatchPointer(tapArea, 'pointerdown', 100, 100);
    dispatchPointer(document, 'pointerup', 103, 102); // desplazamiento < 10px
    tapArea.click(); // el navegador dispara click tras un pointerup sin arrastre

    expect(overlay.classList.contains('stage-v2--paused')).toBe(true);
  });
});

describe('controles flotantes: auto-hide 3s', () => {
  it('los controles se ocultan a los 3s y reaparecen con un tap', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const controls = document.getElementById('stage-v2-controls');
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(true);

    document.getElementById('stage-v2-tap').click();
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false);
    vi.useRealTimers();
  });

  it('tap con controles ocultos solo los despierta, sin pausar (FIX 4)', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const overlay = document.querySelector('.stage-v2');
    const controls = document.getElementById('stage-v2-controls');
    const tapArea = document.getElementById('stage-v2-tap');

    vi.advanceTimersByTime(3000);
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(true);

    tapArea.click();
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false);
    expect(overlay.classList.contains('stage-v2--paused')).toBe(false); // no togglea pausa
    vi.useRealTimers();
  });
});

describe('T6: controles del stage — capas + sliders + salir, sin A−/A+', () => {
  it('incluye #stage-layer-chords, #stage-layer-tono, #stage-open-options y #stage-exit', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('stage-layer-chords')).toBeTruthy();
    expect(document.getElementById('stage-layer-tono')).toBeTruthy();
    expect(document.getElementById('stage-open-options')).toBeTruthy();
    expect(document.getElementById('stage-exit')).toBeTruthy();
  });

  it('NO incluye A−/A+', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.querySelector('[aria-label="Reducir tamaño de letra"]')).toBeNull();
    expect(document.querySelector('[aria-label="Aumentar tamaño de letra"]')).toBeNull();
  });

  it('#stage-layer-chords togglea la capa, comparte estado con layerStore y no resetea índice ni timer', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('stage-v2-next').click(); // index=1: "Segunda línea"
    expect(document.getElementById('stage-v2-text').textContent).toBe('Segunda línea');

    document.getElementById('stage-layer-chords').click();
    expect(document.getElementById('stage-layer-chords').getAttribute('aria-pressed')).toBe('true');
    expect(getLayers().chords).toBe(true); // paridad: mismo estado que la vista normal
    expect(document.getElementById('stage-v2-text').textContent).toBe('Segunda línea'); // índice preservado

    vi.advanceTimersByTime(8000); // el motor de avance sigue vivo tras el toggle
    expect(document.getElementById('stage-v2-text').textContent).not.toBe('Segunda línea');
    vi.useRealTimers();
  });

  it('#stage-layer-tono togglea la capa tono y persiste en layerStore', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('stage-layer-tono').click();
    expect(document.getElementById('stage-layer-tono').getAttribute('aria-pressed')).toBe('true');
    expect(getLayers().tono).toBe(true);
  });
});

describe('T6: sheet de opciones compartido (font+velocidad) desde #stage-open-options', () => {
  afterEach(() => closeOptionsSheet());

  it('BUG Important (review): los controles siguen visibles al cerrar el sheet aunque hayan pasado >=3s con el sheet abierto', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const controls = document.getElementById('stage-v2-controls');

    document.getElementById('stage-open-options').click();
    vi.advanceTimersByTime(3500); // > CONTROLS_HIDE_MS mientras el sheet está abierto
    closeOptionsSheet();

    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false);
    vi.useRealTimers();
  });

  it('abre el sheet compartido con los grupos TAMAÑO y AUTO-SCROLL, sin TONO', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('stage-open-options').click();
    expect(document.querySelector('.osheet')).toBeTruthy();
    expect(document.querySelector('#osheet-font')).toBeTruthy();
    expect(document.querySelector('#osheet-autoscroll')).toBeTruthy();
    expect(document.querySelector('#osheet-tono')).toBeNull(); // sin setter de transposición en el stage
  });

  it('FIX finding 3: el sheet del stage no trae VOCES VISIBLES (sin onToggleVoice, quedaban switches muertos)', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('stage-open-options').click();
    const headers = Array.from(document.querySelectorAll('.osheet__h')).map((h) => h.textContent);
    expect(headers).not.toContain('VOCES VISIBLES');
    expect(document.querySelector('.osheet__voices')).toBeNull();
  });

  it('A+ del sheet aumenta la escala de fuente del stage y la persiste', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const currentEl = document.getElementById('stage-v2-current');
    const baseSize = Number.parseFloat(currentEl.style.fontSize);

    document.getElementById('stage-open-options').click();
    document.querySelector('[data-act="fup"]').click();

    const biggerSize = Number.parseFloat(currentEl.style.fontSize);
    expect(biggerSize).toBeGreaterThan(baseSize);
    expect(Number.parseFloat(localStorage.getItem('hkn-stage-font-scale'))).toBeCloseTo(1.1);
  });

  it('+ de AUTO-SCROLL del sheet acelera el motor de avance sin reabrir el escenario', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    document.getElementById('stage-open-options').click();
    document.querySelector('[data-act="asup"]').click();
    expect(document.querySelector('#osheet-autoscroll').textContent).toMatch(/%/);
    const stored = Number.parseFloat(localStorage.getItem('hkn-autoscroll-speed:song-1'));
    expect(stored).toBeGreaterThan(0.5); // default
  });
});

describe('T6: paridad de capas en la línea actual (mismos markers que la vista normal)', () => {
  function buildLayeredSong() {
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
      ],
    });
  }

  it('ambas capas off: markers de buildLetraLineHTML', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildLayeredSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('stage-v2-text').innerHTML).toBe(buildLetraLineHTML('Primera línea'));
  });

  it('capa Acordes on: markers de buildChordsLineHTML', () => {
    setLayer('chords', true);
    const sv = mountSongView();
    enterStage(sv, { song: buildLayeredSong(), getActiveVoice: () => 'soprano-1' });
    const expected = buildChordsLineHTML('Primera línea', [{ pos: 0, ch: 'C' }], { notation: 'anglo' });
    expect(document.getElementById('stage-v2-text').innerHTML).toBe(expected);
  });

  it('capa Tono on: markers de buildTonoLineHTML', () => {
    setLayer('tono', true);
    const sv = mountSongView();
    enterStage(sv, { song: buildLayeredSong(), getActiveVoice: () => 'soprano-1' });
    const line = { text: 'Primera línea', groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' }] };
    const expected = buildTonoLineHTML(line, 'soprano-1', 'voice-text--soprano', { notation: 'anglo' });
    expect(document.getElementById('stage-v2-text').innerHTML).toBe(expected);
  });

  it('FIX finding A: sin row legacy `#stage-v2-chords` superpuesto al render por capas', () => {
    setLayer('tono', true);
    const sv = mountSongView();
    enterStage(sv, { song: buildLayeredSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('stage-v2-chords')).toBeNull();
    expect(document.querySelector('.stage-v2__chords')).toBeNull();
  });

  it('FINDING 1: capa Acordes global on pero canción sin acordes → markers de buildLetraLineHTML (sin sangrado)', () => {
    setLayer('chords', true); // preferencia global, encendida en otra canción con acordes
    const songSinAcordes = buildSong({
      sections: [
        {
          type: 'verse',
          label: 'Verso 1',
          lines: [{ text: 'Primera línea', chords: [], groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' }] }],
        },
      ],
    });
    const sv = mountSongView();
    enterStage(sv, { song: songSinAcordes, getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('stage-v2-text').innerHTML).toBe(buildLetraLineHTML('Primera línea'));
  });

  it('modos excluyentes: activar Tono con Acordes on apaga Acordes (mixed ya no es alcanzable)', () => {
    setLayer('chords', true);
    setLayer('tono', true); // el store apaga chords al encender tono (exclusión mutua)
    const sv = mountSongView();
    enterStage(sv, { song: buildLayeredSong(), getActiveVoice: () => 'soprano-1' });
    const line = { text: 'Primera línea', groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'C4' }] };
    const expected = buildTonoLineHTML(line, 'soprano-1', 'voice-text--soprano', { notation: 'anglo' });
    expect(document.getElementById('stage-v2-text').innerHTML).toBe(expected);
    expect(document.getElementById('stage-layer-chords').getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('stage-layer-tono').getAttribute('aria-pressed')).toBe('true');
  });

  it('#stage-layer-tono togglea con #stage-layer-chords activo: apaga chords y resincroniza ambos botones', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildLayeredSong(), getActiveVoice: () => 'soprano-1' });
    document.getElementById('stage-layer-chords').click();
    document.getElementById('stage-layer-tono').click();
    expect(document.getElementById('stage-layer-chords').getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('stage-layer-tono').getAttribute('aria-pressed')).toBe('true');
    expect(getLayers()).toEqual({ chords: false, tono: true });
  });
});

describe('T6: FAB de auto-scroll (#stage-autoscroll-fab) siempre presente', () => {
  it.each([
    ['lyrics', false, false],
    ['chords', true, false],
    ['tono', false, true],
    ['mixed', true, true],
  ])('existe en el estado de capas "%s"', (_label, chords, tono) => {
    setLayer('chords', chords);
    setLayer('tono', tono);
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('stage-autoscroll-fab')).toBeTruthy();
  });

  it('togglea pausa/reanuda el motor de avance e invierte el icono', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const overlay = document.querySelector('.stage-v2');
    const fab = document.getElementById('stage-autoscroll-fab');

    fab.click();
    expect(overlay.classList.contains('stage-v2--paused')).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(document.getElementById('stage-v2-text').textContent).toBe('Primera línea'); // sin avanzar

    fab.click();
    expect(overlay.classList.contains('stage-v2--paused')).toBe(false);
    vi.advanceTimersByTime(8000);
    expect(document.getElementById('stage-v2-text').textContent).toBe('Segunda línea');
    vi.useRealTimers();
  });

  it('FIX finding C: en pausa los controles quedan visibles (sin auto-ocultado); al reanudar se re-arma', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const controls = document.getElementById('stage-v2-controls');
    const fab = document.getElementById('stage-autoscroll-fab');

    fab.click(); // pausa
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false);
    vi.advanceTimersByTime(3500); // > CONTROLS_HIDE_MS
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false); // siguen visibles, pausado

    fab.click(); // reanuda
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false); // el FAB despierta los controles
    vi.advanceTimersByTime(3500);
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(true); // se re-arma el auto-hide
    vi.useRealTimers();
  });
});

describe('chips de voz S·A·T·B en el escenario', () => {
  it('pinta un chip por categoría presente en el roster, con la voz activa marcada', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1' });
    const chips = document.querySelectorAll('#stage-v2-voice-chips [data-category]');
    expect(chips).toHaveLength(2); // soprano + tenor (no contralto/bajo en el roster)
    const sopranoChip = document.querySelector('[data-category="soprano"]');
    expect(sopranoChip.classList.contains('stage-v2__voice-chip--active')).toBe(true);
  });

  it('tap en un chip cambia la voz activa y la nota mostrada sin salir del escenario', () => {
    // FIX finding A: el row legacy `#stage-v2-chords` se eliminó (quedaba
    // superpuesto al render por capas) — la nota ahora solo se pinta vía el
    // render por capas (`#stage-v2-text`), así que esta aserción necesita la
    // capa Tono encendida para que la nota sea observable.
    setLayer('tono', true);
    const sv = mountSongView();
    enterStage(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('stage-v2-text').textContent).toContain('C4');

    document.querySelector('[data-category="tenor"]').click();

    expect(document.querySelector('.stage-v2')).toBeTruthy(); // sigue en el escenario
    expect(document.getElementById('stage-v2-text').textContent).toContain('G3');
    expect(
      document
        .querySelector('[data-category="tenor"]')
        .classList.contains('stage-v2__voice-chip--active'),
    ).toBe(true);
    expect(
      document
        .querySelector('[data-category="soprano"]')
        .classList.contains('stage-v2__voice-chip--active'),
    ).toBe(false);
  });

  it('sincroniza la voz elegida con SongView vía ctx.setActiveVoice', () => {
    const sv = mountSongView();
    const setActiveVoice = vi.fn();
    enterStage(sv, {
      song: buildMultiVoiceSong(),
      getActiveVoice: () => 'soprano-1',
      setActiveVoice,
    });

    document.querySelector('[data-category="tenor"]').click();

    expect(setActiveVoice).toHaveBeenCalledWith('tenor', 'tenor-1');
  });
});

describe('FIX 1: detiene el autoscroll clásico al entrar al escenario', () => {
  it('llama a ctx.pauseAutoscroll una vez al entrar', () => {
    const sv = mountSongView();
    const pauseAutoscroll = vi.fn();
    enterStage(sv, { song: buildSong(), pauseAutoscroll });
    expect(pauseAutoscroll).toHaveBeenCalledTimes(1);
  });

  it('sin ctx.pauseAutoscroll no revienta', () => {
    const sv = mountSongView();
    expect(() => enterStage(sv, { song: buildSong() })).not.toThrow();
  });
});

describe('FIX 3: zona muerta de gestos (movimiento bajo el umbral de swipe)', () => {
  it('un movimiento de 20px (bajo los 40px de swipe) pausa igual que un tap', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const overlay = document.querySelector('.stage-v2');
    const tapArea = document.getElementById('stage-v2-tap');

    dispatchPointer(tapArea, 'pointerdown', 100, 100);
    dispatchPointer(document, 'pointermove', 100, 120);
    dispatchPointer(document, 'pointerup', 100, 120); // dy=20px, bajo SWIPE_THRESHOLD_PX
    tapArea.click(); // el navegador dispara click tras el pointerup

    expect(overlay.classList.contains('stage-v2--paused')).toBe(true);
  });
});

describe('F3: afinador embebido en el toggle del stage', () => {
  it('el toggle nace apagado (mic nunca auto-arranca al entrar)', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const toggle = document.querySelector('.stage-v2__btn--tuner');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('stage-v2-tuner-row').hidden).toBe(true);
    expect(detectorStart).not.toHaveBeenCalled();
  });

  it('activar el toggle muestra la franja y arranca el detector; desactivarlo lo para', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    const toggle = document.querySelector('.stage-v2__btn--tuner');

    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('stage-v2-tuner-row').hidden).toBe(false);
    expect(detectorStart).toHaveBeenCalledTimes(1);

    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('stage-v2-tuner-row').hidden).toBe(true);
    expect(detectorStop).toHaveBeenCalledTimes(1);
  });

  it('exitStage para SIEMPRE el detector, incluso con el toggle encendido', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong(), getActiveVoice: () => 'soprano-1' });
    document.querySelector('.stage-v2__btn--tuner').click();
    expect(detectorStart).toHaveBeenCalledTimes(1);

    exitStage();
    expect(detectorStop).toHaveBeenCalledTimes(1);
  });

  it('no crashea si se sale del stage sin haber encendido el toggle', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    expect(() => exitStage()).not.toThrow();
    expect(detectorStop).not.toHaveBeenCalled(); // nunca se creó/arrancó el detector
  });
});
