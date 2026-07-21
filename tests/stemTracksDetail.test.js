// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/pipelineApi.js', () => ({
  getPipelineRun: vi.fn(() => Promise.resolve(null)),
}));

// Manager falso mínimo, mismo patrón que SectionPlayer.test.js: el <audio>
// es real de jsdom (play/pause no implementados ahí, pero no se invocan
// directo — el componente pasa siempre por el manager).
let lastManager = null;

vi.mock('../src/components/SectionPlayer.js', () => ({
  createSectionAudioManager: vi.fn(() => {
    let currentTrack = null;
    lastManager = {
      audio: document.createElement('audio'),
      play: vi.fn((track) => {
        currentTrack = track;
      }),
      pause: vi.fn(),
      getCurrentTrack: vi.fn(() => currentTrack),
      onTime: vi.fn(() => () => {}),
      onEnded: vi.fn(() => () => {}),
      destroy: vi.fn(),
    };
    return lastManager;
  }),
}));

import { createStemTracksDetail } from '../src/components/pipeline/StemTracksDetail.js';

function buildRun(stemsOverrides = {}, clipsStatus = 'pending') {
  return {
    phases: {
      stems: { status: 'done', tracks: {}, ...stemsOverrides },
      clips: { status: clipsStatus },
    },
  };
}

describe('createStemTracksDetail — detalle de Pistas (Task D3c)', () => {
  beforeEach(() => {
    lastManager = null;
  });

  it('renderiza una fila .track por pista presente, con label en español', () => {
    const detail = createStemTracksDetail({ songId: 'song-1' });
    detail.update(buildRun({ tracks: { vocals: 'https://x/vocals.mp3', instrumental: 'https://x/inst.mp3' } }));

    const rows = detail.el.querySelectorAll('.track');
    expect(rows.length).toBe(2);
    expect(detail.el.textContent).toContain('Voz');
    expect(detail.el.textContent).toContain('Instrumental');
  });

  it('el play de una fila llama al .play del gestor compartido (no crea <audio> propio)', () => {
    const detail = createStemTracksDetail({ songId: 'song-1' });
    detail.update(buildRun({ tracks: { vocals: 'https://x/vocals.mp3' } }));

    const playBtn = detail.el.querySelector('.track .track__play');
    playBtn.click();

    expect(lastManager.play).toHaveBeenCalledWith(expect.objectContaining({ id: 'vocals', url: 'https://x/vocals.mp3' }));
  });

  it('stems running con solo vocals: muestra fila ecualizador "Separando lead y coros..."', () => {
    const detail = createStemTracksDetail({ songId: 'song-1' });
    detail.update(buildRun({ status: 'running', tracks: { vocals: 'https://x/vocals.mp3' } }));

    const eqRow = detail.el.querySelector('.track--eq');
    expect(eqRow).toBeTruthy();
    expect(eqRow.querySelector('.ph-loader--eq')).toBeTruthy();
    expect(eqRow.textContent).toContain('Separando lead y coros...');
  });

  it('clips done: agrega sub-línea "Clips por sección listos"', () => {
    const detail = createStemTracksDetail({ songId: 'song-1' });
    detail.update(buildRun({ tracks: { vocals: 'https://x/vocals.mp3' } }, 'done'));

    const clipsLine = detail.el.querySelector('.track--clips');
    expect(clipsLine).toBeTruthy();
    expect(clipsLine.textContent).toContain('Clips por sección listos');
  });

  it('update(run) con una pista nueva agrega la fila sin recrear las existentes', () => {
    const detail = createStemTracksDetail({ songId: 'song-1' });
    detail.update(buildRun({ tracks: { vocals: 'https://x/vocals.mp3' } }));
    const firstRow = detail.el.querySelector('.track[data-kind="vocals"]');

    detail.update(buildRun({ tracks: { vocals: 'https://x/vocals.mp3', instrumental: 'https://x/inst.mp3' } }));

    expect(detail.el.querySelectorAll('.track').length).toBe(2);
    expect(detail.el.querySelector('.track[data-kind="vocals"]')).toBe(firstRow);
  });

  it('destroy() llama manager.destroy()', () => {
    const detail = createStemTracksDetail({ songId: 'song-1' });
    detail.update(buildRun({ tracks: { vocals: 'https://x/vocals.mp3' } }));

    detail.destroy();

    expect(lastManager.destroy).toHaveBeenCalled();
  });
});
