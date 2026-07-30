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
