// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let routeCb = null;

vi.mock('../src/router.js', () => ({
  goBack: vi.fn(),
  navigate: vi.fn(),
  onRouteChange: vi.fn((cb) => {
    routeCb = cb;
    return vi.fn();
  }),
}));

vi.mock('../src/lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
}));

vi.mock('../src/components/pipeline/lyrics/LyricsSheet.js', () => ({
  LyricsSheet: vi.fn(async () => document.createElement('div')),
}));

vi.mock('../src/lib/pipelineApi.js', () => ({
  getPipelineRun: vi.fn(),
  reopenLyrics: vi.fn(),
  publishLyricsToSongbook: vi.fn(),
}));

vi.mock('../src/components/ConfirmDialog.js', () => ({
  confirmDialog: vi.fn(async () => true),
}));

vi.mock('../src/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

// El número de paso se deriva de ROWS (SongPipelineView.js): mockeado acá
// para poder mover `lyrics_review` de posición y verificar que el subtítulo
// no está hardcodeado en LyricsSheetView.
let mockRows = [
  { key: 'upload', title: 'Audio' },
  { key: 'stems', title: 'Pistas' },
  { key: 'structure', title: 'Secciones' },
  { key: 'lyrics_review', title: 'Letra' },
  { key: 'sync', title: 'Sincronía' },
  { key: 'pitch', title: 'Tono por sílaba' },
  { key: 'clips', title: 'Clips por sección' },
];

vi.mock('../src/components/pipeline/SongPipelineView.js', () => ({
  get ROWS() {
    return mockRows;
  },
}));

import { renderLyricsSheetView } from '../src/components/pipeline/lyrics/LyricsSheetView.js';
import { navigate } from '../src/router.js';
import { fetchSongDetail } from '../src/lib/store.js';
import { LyricsSheet } from '../src/components/pipeline/lyrics/LyricsSheet.js';
import { getPipelineRun, reopenLyrics, publishLyricsToSongbook } from '../src/lib/pipelineApi.js';
import { confirmDialog } from '../src/components/ConfirmDialog.js';
import { showToast } from '../src/lib/toast.js';

const SONG_ID = 'song-1';

async function flushPromises(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe('LyricsSheetView (S3a-ii, Task 1)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    routeCb = null;
    mockRows = [
      { key: 'upload', title: 'Audio' },
      { key: 'stems', title: 'Pistas' },
      { key: 'structure', title: 'Secciones' },
      { key: 'lyrics_review', title: 'Letra' },
      { key: 'sync', title: 'Sincronía' },
      { key: 'pitch', title: 'Tono por sílaba' },
      { key: 'clips', title: 'Clips por sección' },
    ];
    vi.clearAllMocks();
    fetchSongDetail.mockResolvedValue({ id: SONG_ID, title: 'Canción de prueba' });
    // Default: sin run activo (equivalente al camino feliz de antes de Task
    // 3) — cae a montar LyricsSheet directo, igual que los tests de Task 1.
    getPipelineRun.mockResolvedValue(null);
    confirmDialog.mockResolvedValue(true);
  });

  afterEach(() => {
    container.remove();
  });

  it('pinta título "Letra" y el subtítulo con el nombre de la canción y el paso', async () => {
    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    const title = container.querySelector('.pipeline-view__title');
    expect(title.textContent).toBe('Letra');
    const subtitle = container.querySelector('.pipeline-view__subtitle');
    expect(subtitle.textContent).toBe('Canción de prueba · paso 4 de 7');
  });

  it('el numero de paso se deriva de ROWS, no esta hardcodeado', async () => {
    // Mover lyrics_review a otra posición (índice 1: paso 2 de 7) y verificar
    // que el subtítulo lo refleja.
    mockRows = [
      { key: 'upload', title: 'Audio' },
      { key: 'lyrics_review', title: 'Letra' },
      { key: 'stems', title: 'Pistas' },
      { key: 'structure', title: 'Secciones' },
      { key: 'sync', title: 'Sincronía' },
      { key: 'pitch', title: 'Tono por sílaba' },
      { key: 'clips', title: 'Clips por sección' },
    ];

    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    const subtitle = container.querySelector('.pipeline-view__subtitle');
    expect(subtitle.textContent).toBe('Canción de prueba · paso 2 de 7');
  });

  it('volver navega a /song/:id/procesamiento', async () => {
    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    container.querySelector('.pipeline-view__back').click();
    expect(navigate).toHaveBeenCalledWith(`/song/${SONG_ID}/procesamiento`);
  });

  it('monta la hoja (LyricsSheet)', async () => {
    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    expect(LyricsSheet).toHaveBeenCalledWith(expect.objectContaining({ songId: SONG_ID }));
    expect(container.querySelector('.lyrics-sheet-view__body').children.length).toBeGreaterThan(0);
  });

  it('teardown: navegar afuera limpia la suscripción sin romper', async () => {
    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    expect(() => routeCb()).not.toThrow();
  });
});

describe('LyricsSheetView — estados de letra aprobada/error/divergencia (S3a-ii, Task 3)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    routeCb = null;
    vi.clearAllMocks();
    fetchSongDetail.mockResolvedValue({ id: SONG_ID, title: 'Canción de prueba' });
    confirmDialog.mockResolvedValue(true);
  });

  afterEach(() => {
    container.remove();
  });

  it('un run con lyrics_review done pinta el aviso ámbar de aprobada, no el rojo (equivalente al 404 "sin ejecución esperando" de la API)', async () => {
    getPipelineRun.mockResolvedValue({
      run: { phases: { lyrics_review: { status: 'done' } }, lyricsDiverged: false },
    });

    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    expect(LyricsSheet).not.toHaveBeenCalled();
    expect(container.querySelector('.lrp__error')).toBeNull();
    const notice = container.querySelector('.lyrics-sheet-view__notice--approved');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain(
      'Letra aprobada. Editarla recalcula sincronía y tono por sílaba',
    );
    expect(container.querySelector('.lyrics-sheet-view__edit')).not.toBeNull();
    expect(container.querySelector('.lyrics-sheet-view__publish')).not.toBeNull();
  });

  it('un 500 pinta el rojo con «Reintentar» y el botón vuelve a cargar', async () => {
    const err = new Error('Error del servidor');
    err.status = 500;
    getPipelineRun.mockRejectedValueOnce(err);
    getPipelineRun.mockResolvedValueOnce(null);

    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    const errorEl = container.querySelector('.lrp__error');
    expect(errorEl).not.toBeNull();
    const retryBtn = container.querySelector('.lrp__error-retry');
    expect(retryBtn.textContent).toBe('Reintentar');

    retryBtn.click();
    await flushPromises();

    expect(getPipelineRun).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.lrp__error')).toBeNull();
    expect(LyricsSheet).toHaveBeenCalled();
  });

  it('«Editar letra» reabre la letra aprobada y deja la hoja editable', async () => {
    getPipelineRun.mockResolvedValueOnce({
      run: { phases: { lyrics_review: { status: 'done' } }, lyricsDiverged: false },
    });
    getPipelineRun.mockResolvedValueOnce(null);
    reopenLyrics.mockResolvedValue({ success: true });

    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    container.querySelector('.lyrics-sheet-view__edit').click();
    await flushPromises();

    expect(confirmDialog).toHaveBeenCalled();
    expect(reopenLyrics).toHaveBeenCalledWith(SONG_ID);
    expect(container.querySelector('.lyrics-sheet-view__notice--approved')).toBeNull();
    expect(LyricsSheet).toHaveBeenCalled();
  });

  it('la señal de divergencia pinta el ámbar de "letra divergente del cancionero"', async () => {
    getPipelineRun.mockResolvedValue({
      run: { phases: { lyrics_review: { status: 'done' } }, lyricsDiverged: true },
    });

    renderLyricsSheetView(container, SONG_ID);
    await flushPromises();

    const notice = container.querySelector('.lyrics-sheet-view__notice--diverged');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain(
      'La letra publicada en el cancionero cambió después de aprobar esta',
    );

    container.querySelector('.lyrics-sheet-view__view-diff').click();
    expect(navigate).toHaveBeenCalledWith(`/song/${SONG_ID}`);
  });
});
