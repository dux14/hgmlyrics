// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let watchOnChange = null;

vi.mock('../src/lib/pipelineApi.js', () => ({
  watchPipelineRun: vi.fn((songId, onChange) => {
    watchOnChange = onChange;
    return vi.fn(); // unsubscribe
  }),
  retryPipelinePhase: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../src/components/pipeline/LyricsReviewPanel.js', () => ({
  LyricsReviewPanel: vi.fn(async () => document.createElement('div')),
}));

vi.mock('../src/router.js', () => ({
  goBack: vi.fn(),
  onRouteChange: vi.fn(() => vi.fn()),
}));

import { renderSongPipelineView } from '../src/components/pipeline/SongPipelineView.js';
import { watchPipelineRun, retryPipelinePhase } from '../src/lib/pipelineApi.js';
import { LyricsReviewPanel } from '../src/components/pipeline/LyricsReviewPanel.js';

const SONG_ID = 'song-1';

/** Espera N vueltas de microtask (para flushear la factory async del panel). */
async function flushPromises(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function buildRun(phaseOverrides = {}, runOverrides = {}) {
  const base = {
    upload: { status: 'pending' },
    stems: { status: 'pending' },
    lyrics_review: { status: 'pending' },
    sync: { status: 'pending' },
    pitch: { status: 'pending' },
    clips: { status: 'pending' },
  };
  const phases = { ...base };
  Object.entries(phaseOverrides).forEach(([k, v]) => {
    phases[k] = { ...phases[k], ...v };
  });
  return { status: 'processing', phases, inputMeta: { filename: 'a.mp3' }, ...runOverrides };
}

describe('SongPipelineView — esqueleto stepper (Task D3a)', () => {
  let container;

  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({ matches: false }));
    container = document.createElement('div');
    document.body.appendChild(container);
    watchOnChange = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
  });

  it('fases pending con letra no aprobada: sync/pitch quedan bloqueadas (.wait)', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    const syncRow = container.querySelector('[data-phase="sync"]');
    const pitchRow = container.querySelector('[data-phase="pitch"]');

    expect(syncRow.querySelector('.dot.wait')).toBeTruthy();
    expect(syncRow.textContent).toContain('Arranca al aprobar la letra');
    expect(pitchRow.querySelector('.dot.wait')).toBeTruthy();
    expect(pitchRow.textContent).toContain('Arranca al aprobar la letra');
  });

  it('stems running: fila Pistas muestra dot .run y loader ecualizador', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({ stems: { status: 'running' } }) });

    const row = container.querySelector('[data-phase="stems"]');
    expect(row.querySelector('.dot.run')).toBeTruthy();
    expect(row.querySelector('.ph-loader--eq')).toBeTruthy();
  });

  it('run awaiting_lyrics: fila Letra monta LyricsReviewPanel y muestra dot .act', async () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    await flushPromises();

    expect(LyricsReviewPanel).toHaveBeenCalledWith(
      expect.objectContaining({ songId: SONG_ID }),
    );
    const row = container.querySelector('[data-phase="lyrics_review"]');
    expect(row.querySelector('.dot.act')).toBeTruthy();
    expect(row.querySelector('.phase__detail').children.length).toBeGreaterThan(0);
  });

  it('no vuelve a montar el panel de letra en re-renders sucesivos', async () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    await flushPromises();
    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    await flushPromises();

    expect(LyricsReviewPanel).toHaveBeenCalledTimes(1);
  });

  it('fase failed: boton Reintentar fase llama retryPipelinePhase con la fase', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({ upload: { status: 'failed', error: 'boom' } }) });

    const row = container.querySelector('[data-phase="upload"]');
    const btn = row.querySelector('.phase__action');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Reintentar fase');

    btn.click();
    expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'upload');
  });

  it('fase stale: boton reprocesa sincronia y tono (sync + pitch)', async () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({
      run: buildRun({
        lyrics_review: { status: 'done' },
        sync: { status: 'stale' },
        pitch: { status: 'stale' },
      }),
    });

    const row = container.querySelector('[data-phase="sync"]');
    const btn = row.querySelector('.phase__action');
    expect(btn.textContent).toBe('Re-procesar sincronía y tono');

    btn.click();
    await flushPromises();
    expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'sync');
    expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'pitch');
  });

  it('re-render por evento del watcher no recrea el contenedor', () => {
    renderSongPipelineView(container, SONG_ID);
    const view = container.querySelector('.pipeline-view');

    watchOnChange({ run: buildRun() });
    watchOnChange({ run: buildRun({ upload: { status: 'done' } }) });

    expect(container.querySelector('.pipeline-view')).toBe(view);
  });

  it('la pill refleja la cantidad de fases done', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({
      run: buildRun({
        upload: { status: 'done' },
        stems: { status: 'done' },
        lyrics_review: { status: 'done' },
      }),
    });

    const pill = container.querySelector('.pipeline-view__pill');
    expect(pill.textContent).toBe('3 de 5 fases');
  });

  it('suscribe watchPipelineRun al montar', () => {
    renderSongPipelineView(container, SONG_ID);
    expect(watchPipelineRun).toHaveBeenCalledWith(SONG_ID, expect.any(Function));
  });
});
