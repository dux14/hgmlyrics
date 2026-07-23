// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getSongAudio = vi.fn();
vi.mock('../src/lib/songAudioApi.js', () => ({
  getSongAudio: (...args) => getSongAudio(...args),
}));

import { createConfidenceSummary } from '../src/components/pipeline/ConfidenceSummary.js';

const SONG_ID = 'song-1';

function buildRun(overrides = {}) {
  return {
    phases: { sync: { status: 'pending' } },
    ...overrides,
  };
}

describe('ConfidenceSummary (Task 17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSongAudio.mockResolvedValue({ audio: null, timings: null });
  });

  it('0 items: no renderiza nada (ni contenedor vacío)', () => {
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase: vi.fn() });
    summary.update(buildRun());

    expect(summary.el.hidden).toBe(true);
    expect(summary.el.innerHTML).toBe('');
  });

  it('conflictos pendientes de la letra: agrega un item con la fase lyrics_review', () => {
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase: vi.fn() });
    summary.update(buildRun(), { conflictsCount: 3, structureWarning: null });

    expect(summary.el.hidden).toBe(false);
    expect(summary.el.textContent).toContain('3 conflictos sin resolver en la letra');
    expect(summary.el.querySelector('[data-target-phase="lyrics_review"]')).toBeTruthy();
  });

  it('un solo conflicto: singular correcto', () => {
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase: vi.fn() });
    summary.update(buildRun(), { conflictsCount: 1, structureWarning: null });

    expect(summary.el.textContent).toContain('Conflicto sin resolver en la letra');
  });

  it('structureWarning presente: agrega un item con la fase structure', () => {
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase: vi.fn() });
    summary.update(buildRun(), {
      conflictsCount: 0,
      structureWarning:
        'La estructura detectada por audio no coincide con la letra (verse: letra tiene 2, audio detectó 3)',
    });

    expect(summary.el.hidden).toBe(false);
    expect(summary.el.textContent).toContain(
      'La estructura detectada por audio no coincide con la letra',
    );
    expect(summary.el.querySelector('[data-target-phase="structure"]')).toBeTruthy();
  });

  it('sync done con líneas interpolated/score bajo: trae timings y agrega el item de sincronía', async () => {
    getSongAudio.mockResolvedValue({
      audio: { url: 'x', durationSec: 100 },
      timings: {
        status: 'ready',
        lines: [
          { i: 0, startMs: 0, score: 0.9, interpolated: false },
          { i: 1, startMs: 100, score: 0.4, interpolated: false },
          { i: 2, startMs: 200, score: null, interpolated: true },
        ],
      },
    });
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase: vi.fn() });
    summary.update(buildRun({ phases: { sync: { status: 'done' } } }));

    await vi.waitFor(() => expect(getSongAudio).toHaveBeenCalledWith(SONG_ID));
    // ensureTimings dispara un update async: esperar el re-render
    await vi.waitFor(() => expect(summary.el.hidden).toBe(false));

    expect(summary.el.textContent).toContain('2 líneas con sincronía de baja confianza');
    expect(summary.el.querySelector('[data-target-phase="sync"]')).toBeTruthy();
  });

  it('score como string (NUMERIC de Postgres): igual cuenta como baja confianza si es < 0.6', async () => {
    getSongAudio.mockResolvedValue({
      audio: null,
      timings: {
        status: 'ready',
        lines: [{ i: 0, startMs: 0, score: '0.4', interpolated: false }],
      },
    });
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase: vi.fn() });
    summary.update(buildRun({ phases: { sync: { status: 'done' } } }));

    await vi.waitFor(() => expect(summary.el.textContent).toContain('sincronía de baja confianza'));
  });

  it('sync no disponible (fetch null): no rompe y no aporta items', async () => {
    getSongAudio.mockResolvedValue(null);
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase: vi.fn() });
    summary.update(buildRun({ phases: { sync: { status: 'done' } } }));

    await vi.waitFor(() => expect(getSongAudio).toHaveBeenCalled());
    expect(summary.el.hidden).toBe(true);
  });

  it('click en un item: llama scrollToPhase con la fase del item', () => {
    const scrollToPhase = vi.fn();
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase });
    summary.update(buildRun(), { conflictsCount: 2, structureWarning: null });

    summary.el.querySelector('[data-target-phase="lyrics_review"]').click();

    expect(scrollToPhase).toHaveBeenCalledWith('lyrics_review');
  });

  it('update() repetido con el mismo run/lyricsData no duplica items ni listeners', () => {
    const scrollToPhase = vi.fn();
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase });
    const lyricsData = { conflictsCount: 2, structureWarning: null };
    summary.update(buildRun(), lyricsData);
    summary.update(buildRun(), lyricsData);

    expect(summary.el.querySelectorAll('[data-target-phase="lyrics_review"]').length).toBe(1);

    summary.el.querySelector('[data-target-phase="lyrics_review"]').click();
    expect(scrollToPhase).toHaveBeenCalledTimes(1);
  });

  it('destroy(): vacía el nodo y update() posterior no rompe ni repinta', () => {
    const summary = createConfidenceSummary({ songId: SONG_ID, scrollToPhase: vi.fn() });
    summary.update(buildRun(), { conflictsCount: 1, structureWarning: null });
    summary.destroy();

    expect(summary.el.innerHTML).toBe('');

    summary.update(buildRun(), { conflictsCount: 5, structureWarning: null });
    expect(summary.el.innerHTML).toBe('');
  });
});
