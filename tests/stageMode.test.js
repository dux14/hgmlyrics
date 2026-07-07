import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enterStage, exitStage, projectLines, speedToSecondsPerLine } from '../src/components/StageMode.js';

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

  it('tap en el area central pausa/reanuda el avance automático', () => {
    vi.useFakeTimers();
    const sv = mountSongView();
    enterStage(sv, { song: buildSong() });
    const overlay = document.querySelector('.stage-v2');
    const tapArea = document.getElementById('stage-v2-tap');

    tapArea.click(); // pausa
    expect(overlay.classList.contains('stage-v2--paused')).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(document.getElementById('stage-v2-text').textContent).toBe('Primera línea'); // sin avanzar

    tapArea.click(); // reanuda
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
