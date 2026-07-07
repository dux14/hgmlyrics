import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enterStage, exitStage, projectLines, speedToSecondsPerLine } from '../src/components/StageMode.js';

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
          { text: 'Hablado sin nota', spoken: true, groups: [{ start: 0, end: 7, voiceId: 'soprano-1', note: 'E4' }] },
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

    // La pausa larga auto-ocultó los controles: el próximo tap solo los
    // despierta (FIX 4), no reanuda todavía.
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(true);
    tapArea.click();
    expect(controls.classList.contains('stage-v2__controls--hidden')).toBe(false);
    expect(overlay.classList.contains('stage-v2--paused')).toBe(true); // sigue pausado

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

  it('el boton salir cierra el escenario', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    document.getElementById('stage-v2-exit').click();
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

describe('controles flotantes: auto-hide 3s, A±', () => {
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

  it('A+ aumenta la escala de fuente y la persiste; A- la reduce', () => {
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const currentEl = document.getElementById('stage-v2-current');
    const baseSize = Number.parseFloat(currentEl.style.fontSize);

    document.getElementById('stage-v2-font-increase').click();
    const biggerSize = Number.parseFloat(currentEl.style.fontSize);
    expect(biggerSize).toBeGreaterThan(baseSize);
    expect(Number.parseFloat(localStorage.getItem('hkn-stage-font-scale'))).toBeCloseTo(1.1);

    document.getElementById('stage-v2-font-decrease').click();
    document.getElementById('stage-v2-font-decrease').click();
    const smallerSize = Number.parseFloat(currentEl.style.fontSize);
    expect(smallerSize).toBeLessThan(baseSize);
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
    const sv = mountSongView();
    enterStage(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1' });
    expect(document.getElementById('stage-v2-chords').textContent).toContain('C4');

    document.querySelector('[data-category="tenor"]').click();

    expect(document.querySelector('.stage-v2')).toBeTruthy(); // sigue en el escenario
    expect(document.getElementById('stage-v2-chords').textContent).toContain('G3');
    expect(document.querySelector('[data-category="tenor"]').classList.contains('stage-v2__voice-chip--active')).toBe(
      true,
    );
    expect(document.querySelector('[data-category="soprano"]').classList.contains('stage-v2__voice-chip--active')).toBe(
      false,
    );
  });

  it('sincroniza la voz elegida con SongView vía ctx.setActiveVoice', () => {
    const sv = mountSongView();
    const setActiveVoice = vi.fn();
    enterStage(sv, { song: buildMultiVoiceSong(), getActiveVoice: () => 'soprano-1', setActiveVoice });

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
