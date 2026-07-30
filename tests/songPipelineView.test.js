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
  reopenLyrics: vi.fn(() => Promise.resolve({ success: true })),
  publishLyricsToSongbook: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../src/components/ConfirmDialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../src/lib/toast.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('../src/components/pipeline/lyrics/LyricsSheet.js', () => ({
  LyricsSheet: vi.fn(async () => document.createElement('div')),
}));

// D3b (UploadPhaseCard) tiene su propio test dedicado: aquí se mockea como
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

// D3c (StemTracksDetail) tiene su propio test dedicado: aquí se mockea como
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

// D3d (SyncFineTuning) tiene su propio test dedicado: aquí se mockea como
// caja negra, igual que UploadPhaseCard y StemTracksDetail.
let lastSyncTuningDestroy = null;
let lastSyncTuningUpdate = null;
let lastSyncTuningArgs = null;
let lastSyncTuningSyncSongText = null;

vi.mock('../src/components/pipeline/SyncFineTuning.js', () => ({
  createSyncFineTuning: vi.fn((args) => {
    lastSyncTuningArgs = args;
    lastSyncTuningDestroy = vi.fn();
    lastSyncTuningUpdate = vi.fn();
    lastSyncTuningSyncSongText = vi.fn();
    return {
      el: document.createElement('div'),
      refresh: vi.fn(),
      update: lastSyncTuningUpdate,
      syncSongText: lastSyncTuningSyncSongText,
      destroy: lastSyncTuningDestroy,
    };
  }),
}));

// StructureDetail (Task 16) tiene su propio test dedicado: aquí se mockea
// como caja negra, igual que StemTracksDetail y SyncFineTuning.
let lastStructureDetailDestroy = null;
let lastStructureDetailUpdate = null;

vi.mock('../src/components/pipeline/StructureDetail.js', () => ({
  createStructureDetail: vi.fn(() => {
    lastStructureDetailDestroy = vi.fn();
    lastStructureDetailUpdate = vi.fn();
    return {
      el: document.createElement('div'),
      update: lastStructureDetailUpdate,
      destroy: lastStructureDetailDestroy,
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

// A7: la vista necesita fetchear la cancion (con sections) para pasarle un
// getSong real a SyncFineTuning — sin esto la fila de sync degrada a
// "Línea N" (root cause del bug). Se mockea junto al resto de store.js.
vi.mock('../src/lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
}));

// Task 4.3: analysis.warnings.orphanSpans llega via el GET del Estudio
// (no via el run del pipeline), self-contained igual que ConfidenceSummary
// con getSongAudio.
vi.mock('../src/lib/studioApi.js', () => ({
  getSongStudio: vi.fn(() => Promise.resolve({ analysis: null })),
}));

import { renderSongPipelineView } from '../src/components/pipeline/SongPipelineView.js';
import {
  watchPipelineRun,
  retryPipelinePhase,
  reopenLyrics,
  publishLyricsToSongbook,
} from '../src/lib/pipelineApi.js';
import { LyricsSheet } from '../src/components/pipeline/lyrics/LyricsSheet.js';
import { confirmDialog } from '../src/components/ConfirmDialog.js';
import { showToast } from '../src/lib/toast.js';
import { fetchSongDetail } from '../src/lib/store.js';
import { getSongStudio } from '../src/lib/studioApi.js';

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
    lastSyncTuningArgs = null;
    lastSyncTuningSyncSongText = null;
    lastStructureDetailDestroy = null;
    lastStructureDetailUpdate = null;
    vi.clearAllMocks();
    confirmDialog.mockResolvedValue(true);
    fetchSongDetail.mockResolvedValue({
      id: SONG_ID,
      sections: [{ type: 'verse', lines: [{ text: 'Hola' }] }],
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('header tiene link Ver en Estudio hacia /song/:id/estudio', () => {
    renderSongPipelineView(container, SONG_ID);
    const link = container.querySelector('.pipeline-view__studio-link');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe(`#/song/${SONG_ID}/estudio`);
  });

  it('escapa songId malicioso en el href de Ver en Estudio (XSS reflejada)', () => {
    const maliciousId = 'x"><img src=y onerror=alert(1)>';
    renderSongPipelineView(container, maliciousId);
    // Escapado: el ataque no rompe el atributo href ni inyecta un <img> real
    // como hermano del link (sin escapar, el `"` cierra el atributo y el
    // `<img>` queda como elemento del DOM).
    expect(container.querySelector('img[src="y"]')).toBeNull();
    const link = container.querySelector('.pipeline-view__studio-link');
    expect(link).toBeTruthy();
    expect(link.parentElement.children.length).toBe(4); // back, h1, link, pill — sin <img> colado
    // El valor del atributo queda intacto (los entities decodean al parsear,
    // pero al no romper el href no se crea markup nuevo).
    expect(link.getAttribute('href')).toBe(`#/song/${maliciousId}/estudio`);
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

  it('run awaiting_lyrics: fila Letra monta LyricsSheet y muestra dot .act', async () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    await flushPromises();

    expect(LyricsSheet).toHaveBeenCalledWith(expect.objectContaining({ songId: SONG_ID }));
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

    expect(LyricsSheet).toHaveBeenCalledTimes(1);
  });

  it('si LyricsSheet falla al montar, pinta un boton Reintentar que reintenta la factory', async () => {
    LyricsSheet.mockRejectedValueOnce(new Error('boom'));

    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    await flushPromises();

    const row = container.querySelector('[data-phase="lyrics_review"]');
    const errorEl = row.querySelector('.lrp__error');
    expect(errorEl).toBeTruthy();
    const retryBtn = row.querySelector('.lrp__error-retry');
    expect(retryBtn).toBeTruthy();
    expect(LyricsSheet).toHaveBeenCalledTimes(1);

    retryBtn.click();
    await flushPromises();

    // El segundo intento (ya sin rechazo forzado) reemplaza el sentinel de
    // error por el panel real: el gate de letra no queda muerto.
    expect(LyricsSheet).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-phase="lyrics_review"] .lrp__error')).toBeNull();
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

  it('fase pitch failed: pinta "Reintentar fase" y reintenta pitch al click', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({
      run: buildRun({
        lyrics_review: { status: 'done' },
        sync: { status: 'done' },
        pitch: { status: 'failed', error: 'boom' },
      }),
    });

    const row = container.querySelector('[data-phase="pitch"]');
    const btn = row.querySelector('.phase__action');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Reintentar fase');

    btn.click();
    expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'pitch');
  });

  it('fase stale: boton reprocesa sincronia, tono y clips (#8)', async () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({
      run: buildRun({
        lyrics_review: { status: 'done' },
        sync: { status: 'stale' },
        pitch: { status: 'stale' },
        clips: { status: 'stale' },
      }),
    });

    const row = container.querySelector('[data-phase="sync"]');
    const btn = row.querySelector('.phase__action');
    expect(btn.textContent).toBe('Re-procesar sincronía, tono y clips');

    btn.click();
    await flushPromises();
    expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'sync');
    expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'pitch');
    expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'clips');
  });

  describe('retry automático transversal (Entrega 2, Tarea 6)', () => {
    // phase.autoRetries llega tal cual del GET del run (jsonb `phases`, sin
    // transformación del endpoint) -- ver api/songs/[id]/pipeline.js signTracks.
    it('fase failed con autoRetries pendientes: pinta "Reintentando" en vez de darse por vencido', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({
          lyrics_review: { status: 'done' },
          sync: { status: 'done' },
          pitch: { status: 'failed', error: 'boom', autoRetries: 0 },
        }),
      });

      const row = container.querySelector('[data-phase="pitch"]');
      expect(row.textContent).toContain('Reintentando calcular el tono...');
      expect(row.textContent).not.toContain('No se pudo calcular el tono');
      expect(row.querySelector('.dot.run')).toBeTruthy();
      expect(row.querySelector('.dot.act')).toBeFalsy();
      // El botón manual sigue disponible mientras el auto-retry está en curso.
      const btn = row.querySelector('.phase__action');
      expect(btn.textContent).toBe('Reintentar fase');
      btn.click();
      expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'pitch');
    });

    it('fase failed con autoRetries agotados: vuelve al copy de "se rindió" (estado .act)', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({
          lyrics_review: { status: 'done' },
          sync: { status: 'done' },
          pitch: { status: 'failed', error: 'boom', autoRetries: 2 },
        }),
      });

      const row = container.querySelector('[data-phase="pitch"]');
      expect(row.textContent).toContain('No se pudo calcular el tono');
      expect(row.querySelector('.dot.act')).toBeTruthy();
      expect(row.querySelector('.dot.run')).toBeFalsy();
    });

    it('structure failed con autoRetries pendientes: sigue pintándose como pending, best-effort', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ structure: { status: 'failed', error: 'boom', autoRetries: 0 } }),
      });

      const row = container.querySelector('[data-phase="structure"]');
      expect(row.textContent).toContain('No se pudo detectar la estructura');
      expect(row.textContent).not.toContain('Reintentando');
      expect(row.querySelector('.phase__action')).toBeFalsy();
    });
  });

  it('fila clips (#8): tiene su propia fila en el stepper y bloquea si la letra no está aprobada', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    const row = container.querySelector('[data-phase="clips"]');
    expect(row).toBeTruthy();
    expect(row.querySelector('.dot.wait')).toBeTruthy();
    expect(row.textContent).toContain('Arranca al aprobar la letra');
  });

  it('fila clips failed (#8): pinta "Reintentar fase" y reintenta clips al click', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({
      run: buildRun({
        lyrics_review: { status: 'done' },
        sync: { status: 'done' },
        pitch: { status: 'done' },
        clips: { status: 'failed', error: 'boom' },
      }),
    });

    const row = container.querySelector('[data-phase="clips"]');
    const btn = row.querySelector('.phase__action');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Reintentar fase');

    btn.click();
    expect(retryPipelinePhase).toHaveBeenCalledWith(SONG_ID, 'clips');
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
    expect(pill.textContent).toBe('3 de 7 fases');
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
    expect(pill.textContent).toBe('0 de 7 fases');
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

  it('A7: fetchea la cancion al montar y le pasa a SyncFineTuning un getSong con la letra real', async () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({ sync: { status: 'running' } }) });
    await flushPromises();

    expect(fetchSongDetail).toHaveBeenCalledWith(SONG_ID);
    expect(lastSyncTuningArgs.getSong()).toEqual(
      expect.objectContaining({
        id: SONG_ID,
        sections: [{ type: 'verse', lines: [{ text: 'Hola' }] }],
      }),
    );
    // Repinta con syncSongText() (no update()): la transición pending→done
    // de update() puede haberse consumido antes de que este fetch resuelva
    // (carrera con el watcher del run), así que el fetch necesita un camino
    // propio para forzar el repintado.
    expect(lastSyncTuningSyncSongText).toHaveBeenCalled();
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

  it('fila Secciones monta el detalle de StructureDetail y lo actualiza en cada render', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({ structure: { status: 'running' } }) });

    const row = container.querySelector('[data-phase="structure"]');
    expect(row).toBeTruthy();
    expect(row.querySelector('.phase__detail').children.length).toBeGreaterThan(0);
    expect(lastStructureDetailUpdate).toHaveBeenCalled();
  });

  it('fila Secciones va entre Pistas y Letra', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    const rows = Array.from(container.querySelectorAll('.phase')).map((r) => r.dataset.phase);
    expect(rows.indexOf('structure')).toBeGreaterThan(rows.indexOf('stems'));
    expect(rows.indexOf('structure')).toBeLessThan(rows.indexOf('lyrics_review'));
  });

  it('fase structure failed: no ofrece reintento (best-effort, no bloquea el run)', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun({ structure: { status: 'failed', error: 'boom' } }) });

    const row = container.querySelector('[data-phase="structure"]');
    expect(row.querySelector('.dot.act')).toBeFalsy();
    expect(row.querySelector('.phase__action')).toBeFalsy();
    expect(row.textContent).toContain('No se pudo detectar la estructura');
  });

  it('teardown: llama structureDetail.destroy()', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    routeCb();

    expect(lastStructureDetailDestroy).toHaveBeenCalled();
  });

  it('mount-once bajo carrera async real: dos eventos sin await entre ellos montan el panel una sola vez', async () => {
    renderSongPipelineView(container, SONG_ID);

    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    watchOnChange({ run: buildRun({}, { status: 'awaiting_lyrics' }) });
    await flushPromises();

    expect(LyricsSheet).toHaveBeenCalledTimes(1);
  });

  it('esqueleto inmediato: las 5 filas existen antes de que watchPipelineRun emita nada', () => {
    renderSongPipelineView(container, SONG_ID);

    expect(container.querySelectorAll('[data-phase]').length).toBe(7);
  });

  it('error del watcher: muestra el banner con boton Reintentar sin borrar las filas', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ error: new Error('boom') });

    const banner = container.querySelector('.pipeline-view__error');
    expect(banner).toBeTruthy();
    expect(banner.hidden).toBe(false);
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('Reintentar');
    expect(container.querySelectorAll('[data-phase]').length).toBe(7);
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
    expect(container.querySelectorAll('[data-phase]').length).toBe(7);
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

  describe('publicar al cancionero (F4)', () => {
    beforeEach(() => {
      publishLyricsToSongbook.mockResolvedValue({ success: true });
    });

    it('fila Letra en done: muestra el boton "Publicar al cancionero"', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      const row = container.querySelector('[data-phase="lyrics_review"]');
      const btn = row.querySelector('.phase__publish-songbook');
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe('Publicar al cancionero');
    });

    it('fila Letra sin aprobar (awaiting_lyrics): NO muestra el boton de publicar', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'pending' } }, { status: 'awaiting_lyrics' }),
      });

      const row = container.querySelector('[data-phase="lyrics_review"]');
      expect(row.querySelector('.phase__publish-songbook')).toBeFalsy();
    });

    it('otras fases done (ej. stems) no muestran el boton de publicar', () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({ run: buildRun({ stems: { status: 'done' } }) });

      const row = container.querySelector('[data-phase="stems"]');
      expect(row.querySelector('.phase__publish-songbook')).toBeFalsy();
    });

    it('click abre el ConfirmDialog y al confirmar llama publishLyricsToSongbook + toast de exito', async () => {
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      container.querySelector('[data-phase="lyrics_review"] .phase__publish-songbook').click();
      await flushPromises();

      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Publicar'),
          body: expect.stringContaining('reemplazará'),
          danger: true,
        }),
      );
      expect(publishLyricsToSongbook).toHaveBeenCalledWith(SONG_ID);
      expect(showToast).toHaveBeenCalled();
    });

    it('al cancelar el dialogo: NO llama publishLyricsToSongbook', async () => {
      confirmDialog.mockResolvedValueOnce(false);
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      container.querySelector('[data-phase="lyrics_review"] .phase__publish-songbook').click();
      await flushPromises();

      expect(publishLyricsToSongbook).not.toHaveBeenCalled();
    });

    it('si publishLyricsToSongbook falla (404): muestra toast de error y no rompe la vista', async () => {
      publishLyricsToSongbook.mockRejectedValueOnce(new Error('boom'));
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' } }, { status: 'running' }),
      });

      container.querySelector('[data-phase="lyrics_review"] .phase__publish-songbook').click();
      await flushPromises();

      expect(showToast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'error' }),
      );
      expect(container.querySelector('.pipeline-view')).toBeTruthy();
    });
  });

  it('el header no tiene boton de cancelar procesamiento (evita purga destructiva accidental)', () => {
    renderSongPipelineView(container, SONG_ID);
    watchOnChange({ run: buildRun() });

    expect(container.querySelector('.pipeline-view__cancel')).toBeFalsy();
  });

  describe('aviso de audio huerfano (Task 4.3)', () => {
    beforeEach(() => {
      getSongStudio.mockResolvedValue({ analysis: null });
    });

    it('sin warnings en el analisis: no renderiza el aviso', async () => {
      getSongStudio.mockResolvedValue({ analysis: {} });
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      const row = container.querySelector('[data-phase="pitch"]');
      expect(row.querySelector('.phase__orphan-warning')).toBeFalsy();
    });

    it('orphanSpans vacio: no renderiza el aviso', async () => {
      getSongStudio.mockResolvedValue({ analysis: { warnings: { orphanSpans: [] } } });
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      const row = container.querySelector('[data-phase="pitch"]');
      expect(row.querySelector('.phase__orphan-warning')).toBeFalsy();
    });

    it('un tramo: muestra duracion y rango m:ss junto al boton de reabrir', async () => {
      getSongStudio.mockResolvedValue({
        analysis: { warnings: { orphanSpans: [{ startMs: 130000, endMs: 142000 }] } },
      });
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      const row = container.querySelector('[data-phase="pitch"]');
      const warning = row.querySelector('.phase__orphan-warning');
      expect(warning).toBeTruthy();
      expect(warning.textContent).toContain('Hay 12 s con notas y sin letra aprobada (2:10–2:22)');
    });

    it('dos tramos: suma la duracion de ambos', async () => {
      getSongStudio.mockResolvedValue({
        analysis: {
          warnings: {
            orphanSpans: [
              { startMs: 130000, endMs: 142000 },
              { startMs: 200000, endMs: 205000 },
            ],
          },
        },
      });
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      const warning = container.querySelector('[data-phase="pitch"] .phase__orphan-warning');
      expect(warning.textContent).toContain('Hay 17 s con notas y sin letra aprobada');
      expect(warning.textContent).toContain('2:10–2:22');
      expect(warning.textContent).toContain('3:20–3:25');
    });

    it('el boton del aviso reusa la accion de reabrir el gate de letra (reopenLyrics)', async () => {
      getSongStudio.mockResolvedValue({
        analysis: { warnings: { orphanSpans: [{ startMs: 0, endMs: 3000 }] } },
      });
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      const btn = container.querySelector(
        '[data-phase="pitch"] .phase__orphan-warning .phase__action',
      );
      expect(btn).toBeTruthy();
      btn.click();
      await flushPromises();

      expect(confirmDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('Editar letra') }),
      );
      expect(reopenLyrics).toHaveBeenCalledWith(SONG_ID);
    });

    // Fix review d6741d5, hallazgo 1: lyrics_review en 'failed' (carrera de
    // webhook) mientras pitch sigue en 'done' NO debe capturar el onRetry de
    // "Reintentar fase" para el boton del aviso — el aviso se muestra sin
    // boton en vez de llamar retryPipelinePhase por error.
    it('lyrics_review failed con pitch done: el aviso se muestra sin boton', async () => {
      getSongStudio.mockResolvedValue({
        analysis: { warnings: { orphanSpans: [{ startMs: 0, endMs: 3000 }] } },
      });
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'failed' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      const row = container.querySelector('[data-phase="pitch"]');
      const warning = row.querySelector('.phase__orphan-warning');
      expect(warning).toBeTruthy();
      expect(warning.querySelector('.phase__action')).toBeFalsy();
    });

    // Fix review d6741d5, hallazgo 2: dos flancos pending->done de pitch en
    // la misma sesión disparan dos fetches solapados; el que resuelve tarde
    // (respuesta vieja) no debe pisar el estado que dejó el más nuevo.
    it('respuesta vieja del analisis no pisa una mas nueva (guarda de generacion)', async () => {
      let resolveFirst;
      getSongStudio
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({
            analysis: { warnings: { orphanSpans: [{ startMs: 200000, endMs: 205000 }] } },
          }),
        );

      renderSongPipelineView(container, SONG_ID);

      // Primer flanco pending->done de pitch: dispara el primer fetch (lento).
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      // Segundo flanco (reabrir y re-aprobar el gate): pitch vuelve a pending
      // y a done, disparando el segundo fetch (rapido, resuelve primero).
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'pending' } }),
      });
      await flushPromises();
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      // La respuesta vieja del primer fetch resuelve tarde: no debe pisar.
      resolveFirst({
        analysis: { warnings: { orphanSpans: [{ startMs: 130000, endMs: 142000 }] } },
      });
      await flushPromises();

      const warning = container.querySelector('[data-phase="pitch"] .phase__orphan-warning');
      expect(warning.textContent).toContain('3:20–3:25');
      expect(warning.textContent).not.toContain('2:10–2:22');
    });

    // Hallazgo 4: el dato es best-effort desde Modal, puede llegar deforme.
    it('filtra tramos malformados (null, invertido) y solo muestra los validos', async () => {
      getSongStudio.mockResolvedValue({
        analysis: {
          warnings: {
            orphanSpans: [
              null,
              { startMs: 200000, endMs: 190000 }, // invertido: descartado
              { startMs: 130000, endMs: 142000 }, // valido
            ],
          },
        },
      });
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      const row = container.querySelector('[data-phase="pitch"]');
      const warning = row.querySelector('.phase__orphan-warning');
      expect(warning).toBeTruthy();
      expect(warning.textContent).toContain('Hay 12 s con notas y sin letra aprobada (2:10–2:22)');
    });

    it('solo tramos malformados: no renderiza el aviso', async () => {
      getSongStudio.mockResolvedValue({
        analysis: { warnings: { orphanSpans: [null, { startMs: 500, endMs: 100 }] } },
      });
      renderSongPipelineView(container, SONG_ID);
      watchOnChange({
        run: buildRun({ lyrics_review: { status: 'done' }, pitch: { status: 'done' } }),
      });
      await flushPromises();

      const row = container.querySelector('[data-phase="pitch"]');
      expect(row.querySelector('.phase__orphan-warning')).toBeFalsy();
    });
  });
});
