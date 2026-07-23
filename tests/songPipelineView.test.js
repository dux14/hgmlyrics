// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let watchOnChange = null;
let lastUnsub = null;

vi.mock('../src/lib/pipelineApi.js', () => ({
  watchPipelineRun: vi.fn((songId, onChange) => {
    watchOnChange = onChange;
    lastUnsub = vi.fn(); // unsubscribe, con .refresh anexado (mismo contrato que el real)
    lastUnsub.refresh = vi.fn();
    return lastUnsub;
  }),
  retryPipelinePhase: vi.fn(() => Promise.resolve({ success: true })),
  getPipelineRun: vi.fn(() => Promise.resolve(null)),
  cancelPipelineRun: vi.fn(() => Promise.resolve({ success: true })),
  reopenLyrics: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../src/components/ConfirmDialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../src/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('../src/components/pipeline/LyricsReviewPanel.js', () => ({
  LyricsReviewPanel: vi.fn(async () => document.createElement('div')),
}));

// D3b (UploadPhaseCard) tiene su propio test dedicado: acá se mockea como
// una caja negra para no acoplar el esqueleto del stepper a su máquina de
// estados interna.
let lastUploadCardDispose = null;

vi.mock('../src/components/pipeline/UploadPhaseCard.js', () => ({
  createUploadPhaseCard: vi.fn(() => {
    lastUploadCardDispose = vi.fn();
    return {
      el: document.createElement('div'),
      update: vi.fn(),
      dispose: lastUploadCardDispose,
    };
  }),
}));

// D3c (StemTracksDetail) tiene su propio test dedicado: acá se mockea como
// caja negra, igual que UploadPhaseCard.
let lastStemTracksDestroy = null;
let lastStemTracksUpdate = null;

vi.mock('../src/components/pipeline/StemTracksDetail.js', () => ({
  createStemTracksDetail: vi.fn(() => {
    lastStemTracksDestroy = vi.fn();
    lastStemTracksUpdate = vi.fn();
    return {
      el: document.createElement('div'),
      update: lastStemTracksUpdate,
      destroy: lastStemTracksDestroy,
    };
  }),
}));

// D3d (SyncFineTuning) tiene su propio test dedicado: acá se mockea como
// caja negra, igual que UploadPhaseCard y StemTracksDetail.
let lastSyncTuningDestroy = null;
let lastSyncTuningUpdate = null;

vi.mock('../src/components/pipeline/SyncFineTuning.js', () => ({
  createSyncFineTuning: vi.fn(() => {
    lastSyncTuningDestroy = vi.fn();
    lastSyncTuningUpdate = vi.fn();
    return {
      el: document.createElement('div'),
      refresh: vi.fn(),
      update: lastSyncTuningUpdate,
      destroy: lastSyncTuningDestroy,
    };
  }),
}));

let routeCb = null;

vi.mock('../src/router.js', () => ({
  goBack: vi.fn(),
  onRouteChange: vi.fn((cb) => {
    routeCb = cb;
    return vi.fn();
  }),
}));

import { renderSongPipelineView } from '../src/components/pipeline/SongPipelineView.js';
import {
  watchPipelineRun,
  retryPipelinePhase,
  cancelPipelineRun,
  reopenLyrics,
} from '../src/lib/pipelineApi.js';
import { LyricsReviewPanel } from '../src/components/pipeline/LyricsReviewPanel.js';
import { confirmDialog } from '../src/components/ConfirmDialog.js';
import { showToast } from '../src/lib/toast.js';

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
    lastUnsub = null;
    routeCb = null;
    lastUploadCardDispose = null;
    lastStemTracksDestroy = null;
    lastStemTracksUpdate = null;
    lastSyncTuningDestroy = null;
    lastSyncTuningUpdate = null;
    vi.clearAllMocks();
    confirmDialog.mockResolvedValue(true);
    cancelPipelineRun.mockResolvedValue({ success: true });
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

    expect(LyricsReviewPanel).toHaveBeenCalledWith(expect.objectContaining({ songId: SONG_ID }));
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

  it('teardown: navegar afuera desuscribe el watcher y bloquea re-renders posteriores', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });
    const view = container.querySelector('.pipeline-view');

    routeCb();
    expect(lastUnsub).toHaveBeenCalled();

    // Un evento posterior del watcher (p. ej. una promesa en vuelo) no debe
    // operar sobre nodos huérfanos: el guard `destroyed` corta el render.
    watchOnChange({ run: buildRun({ upload: { status: 'done' } }) });
    expect(container.querySelector('.pipeline-view')).toBe(view);
    const pill = container.querySelector('.pipeline-view__pill');
    expect(pill.textContent).toBe('0 de 5 fases');
  });

  it('teardown: llama uploadCard.dispose() para limpiar runs huérfanos', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    routeCb();

    expect(lastUploadCardDispose).toHaveBeenCalled();
  });

  it('fila Pistas monta el detalle de StemTracksDetail y lo actualiza en cada render', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({ stems: { status: 'running' } }) });

    const row = container.querySelector('[data-phase="stems"]');
    expect(row.querySelector('.phase__detail').children.length).toBeGreaterThan(0);
    expect(lastStemTracksUpdate).toHaveBeenCalled();
  });

  it('teardown: llama stemTracks.destroy() para soltar el <audio> del gestor', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    routeCb();

    expect(lastStemTracksDestroy).toHaveBeenCalled();
  });

  it('fila Sincronía monta el detalle de SyncFineTuning y lo actualiza en cada render', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({ sync: { status: 'running' } }) });

    const row = container.querySelector('[data-phase="sync"]');
    expect(row.querySelector('.phase__detail').children.length).toBeGreaterThan(0);
    expect(lastSyncTuningUpdate).toHaveBeenCalled();
  });

  it('teardown: llama syncTuning.destroy() para soltar el mini-player', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    routeCb();

    expect(lastSyncTuningDestroy).toHaveBeenCalled();
  });

  it('mount-once bajo carrera async real: dos eventos sin await entre ellos montan el panel una sola vez', async () => {
    renderSongPipelineView(container, SONG_ID);

    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    await flushPromises();

    expect(LyricsReviewPanel).toHaveBeenCalledTimes(1);
  });

  it('esqueleto inmediato: las 5 filas existen antes de que watchPipelineRun emita nada', () => {
    renderSongPipelineView(container, SONG_ID);

    expect(container.querySelectorAll('[data-phase]').length).toBe(5);
  });

  it('error del watcher: muestra el banner con boton Reintentar sin borrar las filas', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ error: new Error('boom') });

    const banner = container.querySelector('.pipeline-view__error');
    expect(banner).toBeTruthy();
    expect(banner.hidden).toBe(false);
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('Reintentar');
    expect(container.querySelectorAll('[data-phase]').length).toBe(5);
  });

  it('el boton Reintentar del banner de error fuerza un refresh del watcher', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ error: new Error('boom') });

    const btn = container.querySelector('.pipeline-view__error-retry');
    btn.click();

    expect(lastUnsub.refresh).toHaveBeenCalled();
  });

  it('tras un error, un run valido oculta el banner sin borrar las filas', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ error: new Error('boom') });
    watchOnChange({ run: buildRun() });

    const banner = container.querySelector('.pipeline-view__error');
    expect(banner.hidden).toBe(true);
    expect(container.querySelectorAll('[data-phase]').length).toBe(5);
  });

  it('skip por firma: dos eventos con el mismo estado no reconstruyen las filas', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    const row = container.querySelector('[data-phase="upload"]');
    row.classList.remove('phase--enter'); // marca que este render "ya paso"

    watchOnChange({ run: buildRun() }); // mismo estado exacto

    const rowAfter = container.querySelector('[data-phase="upload"]');
    expect(rowAfter).toBe(row); // mismo nodo: no se recreo la fila
    expect(rowAfter.classList.contains('phase--enter')).toBe(false); // no se re-animo
  });

  describe('reabrir letra aprobada (Task 13)', () => {
    beforeEach(() => {
      reopenLyrics.mockResolvedValue({ success: true });
    });

    it('fila Letra en done: muestra el boton "Editar letra"', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      const row = container.querySelector('[data-phase="lyrics_review"]');
      const btn = row.querySelector('.phase__action');
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe('Editar letra');
    });

    it('otras fases done (ej. stems) no muestran boton de accion', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun({ stems: { status: 'done' } }) });

      const row = container.querySelector('[data-phase="stems"]');
      expect(row.querySelector('.phase__action')).toBeFalsy();
    });

    it('click en "Editar letra" abre el ConfirmDialog de advertencia', async () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      container.querySelector('[data-phase="lyrics_review"] .phase__action').click();
      await flushPromises();

      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('Editar'), danger: true }),
      );
    });

    it('al confirmar: llama reopenLyrics, muestra toast y refresca la vista', async () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      container.querySelector('[data-phase="lyrics_review"] .phase__action').click();
      await flushPromises();

      expect(reopenLyrics).toHaveBeenCalledWith(SONG_ID);
      expect(showToast).toHaveBeenCalled();
      expect(lastUnsub.refresh).toHaveBeenCalled();
    });

    it('al cancelar el dialogo: NO llama reopenLyrics', async () => {
      confirmDialog.mockResolvedValueOnce(false);
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      container.querySelector('[data-phase="lyrics_review"] .phase__action').click();
      await flushPromises();

      expect(reopenLyrics).not.toHaveBeenCalled();
    });

    it('si reopenLyrics falla (409): muestra toast de error y no rompe la vista', async () => {
      reopenLyrics.mockRejectedValueOnce(new Error('boom'));
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      container.querySelector('[data-phase="lyrics_review"] .phase__action').click();
      await flushPromises();

      expect(showToast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'error' }),
      );
      expect(container.querySelector('.pipeline-view')).toBeTruthy();
    });
  });

  describe('cancelar procesamiento (Task 12)', () => {
    it('el header tiene un boton para cancelar el procesamiento cuando el run esta activo', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun() }); // status: 'processing' (cancelable)

      const btn = container.querySelector('.pipeline-view__cancel');
      expect(btn).toBeTruthy();
    });

    it('el boton dice su accion real, no "mas opciones" (no sugiere un menu)', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun() });

      const btn = container.querySelector('.pipeline-view__cancel');
      expect(btn.getAttribute('aria-label')).toBe('Cancelar procesamiento');
    });

    it('sin run activo (null): el boton de cancelar no esta presente', () => {
      renderSongPipelineView(container, SONG_ID);
      // Esqueleto inicial: renderPhases(null) ya corrio, sin watchOnChange todavia.

      expect(container.querySelector('.pipeline-view__cancel')).toBeFalsy();
    });

    it.each(['done', 'failed', 'superseded', 'cancelled'])(
      'run en estado terminal %s: el boton de cancelar no esta presente',
      (status) => {
        renderSongPipelineView(container, SONG_ID);
        watchOnChange({ run: buildRun({}, { status }) });

        expect(container.querySelector('.pipeline-view__cancel')).toBeFalsy();
      },
    );

    it.each(['created', 'uploading', 'processing', 'awaiting_lyrics', 'running'])(
      'run en estado activo %s: el boton de cancelar esta presente',
      (status) => {
        renderSongPipelineView(container, SONG_ID);
        watchOnChange({ run: buildRun({}, { status }) });

        expect(container.querySelector('.pipeline-view__cancel')).toBeTruthy();
      },
    );

    it('el run pasa de activo a terminal via watcher: el boton desaparece en el re-render', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun() }); // processing: cancelable
      expect(container.querySelector('.pipeline-view__cancel')).toBeTruthy();

      watchOnChange({ run: buildRun({ upload: { status: 'done' } }, { status: 'done' }) });
      expect(container.querySelector('.pipeline-view__cancel')).toBeFalsy();
    });

    it('click en el boton abre el ConfirmDialog del sistema con copy de advertencia', async () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun() });

      container.querySelector('.pipeline-view__cancel').click();
      await flushPromises();

      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Cancelar'),
          danger: true,
        }),
      );
    });

    it('al confirmar: llama cancelPipelineRun, muestra toast y refresca la vista', async () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun() });

      container.querySelector('.pipeline-view__cancel').click();
      await flushPromises();

      expect(cancelPipelineRun).toHaveBeenCalledWith(SONG_ID);
      expect(showToast).toHaveBeenCalled();
      expect(lastUnsub.refresh).toHaveBeenCalled();
    });

    it('al cancelar el dialogo: NO llama cancelPipelineRun', async () => {
      confirmDialog.mockResolvedValueOnce(false);
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun() });

      container.querySelector('.pipeline-view__cancel').click();
      await flushPromises();

      expect(cancelPipelineRun).not.toHaveBeenCalled();
    });

    it('si cancelPipelineRun falla: muestra toast de error y no rompe la vista', async () => {
      cancelPipelineRun.mockRejectedValueOnce(new Error('boom'));
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun() });

      container.querySelector('.pipeline-view__cancel').click();
      await flushPromises();

      expect(showToast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'error' }),
      );
      expect(container.querySelector('.pipeline-view')).toBeTruthy();
    });
  });
});
