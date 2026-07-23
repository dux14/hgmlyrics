/**
 * SongPipelineView.js — vista admin "stepper" del procesamiento por canción
 * (pipeline unificado, plan D, Task D3a). Muestra las 5 fases visibles
 * (Audio, Pistas, Letra, Sincronía, Tono por sílaba — `clips` no es fila
 * propia, D3b la muestra como sub-línea de Pistas) con estado progresivo vía
 * `watchPipelineRun`. Esta sub-tarea es el esqueleto: dot + copy + retry +
 * stale + montaje del panel de letra (C3). El detalle de Audio/Pistas/
 * Sincronía lo montan D3b/D3c/D3d dentro del slot que deja cada `PhaseRow`.
 */
import '../../styles/pipeline.css';
import { icon } from '../../lib/icons.js';
import { goBack, onRouteChange } from '../../router.js';
import {
  watchPipelineRun,
  retryPipelinePhase,
  getPipelineRun,
  cancelPipelineRun,
  reopenLyrics,
} from '../../lib/pipelineApi.js';
import { showToast } from '../../lib/toast.js';
import { confirmDialog } from '../ConfirmDialog.js';
import { LyricsReviewPanel } from './LyricsReviewPanel.js';
import { PhaseRow } from './PhaseRow.js';
import { createUploadPhaseCard } from './UploadPhaseCard.js';
import { createStemTracksDetail } from './StemTracksDetail.js';
import { createSyncFineTuning } from './SyncFineTuning.js';
import { createStructureDetail } from './StructureDetail.js';
import { createConfidenceSummary } from './ConfidenceSummary.js';

// Estados de run que el DELETE /api/songs/[id]/pipeline acepta cancelar
// (mismo WHERE status IN (...) que api/songs/[id]/pipeline.js#cancelRun):
// fuera de esta lista el endpoint devuelve 404 "No hay una ejecución activa".
// El botón de cancelar del header se gatea con este mismo set para no ofrecer
// una acción destructiva que el backend va a rechazar.
const CANCELABLE_RUN_STATUSES = new Set([
  'created',
  'uploading',
  'processing',
  'awaiting_lyrics',
  'running',
]);

// Filas visibles del stepper, en orden. lyrics_review es la fase "Letra".
// 'structure' (Task 16) es best-effort (ver CRITICAL_PHASES en
// api/_lib/pipeline/state.js): nunca bloquea el run, así que no participa
// del gate de sync/pitch ni ofrece reintento (describePhase la trata aparte).
const ROWS = [
  { key: 'upload', title: 'Audio' },
  { key: 'stems', title: 'Pistas' },
  { key: 'structure', title: 'Secciones' },
  { key: 'lyrics_review', title: 'Letra' },
  { key: 'sync', title: 'Sincronía' },
  { key: 'pitch', title: 'Tono por sílaba' },
];

const SUBTITLES = {
  upload: {
    pending: 'En espera',
    running: 'Subiendo audio...',
    done: 'Audio cargado',
    failed: 'No se pudo cargar el audio',
  },
  stems: {
    pending: 'En espera',
    running: 'Separando pistas...',
    done: 'Pistas separadas',
    failed: 'No se pudo separar las pistas',
  },
  structure: {
    pending: 'En espera',
    running: 'Detectando secciones...',
    done: 'Secciones detectadas',
    failed: 'No se pudo detectar la estructura',
  },
  lyrics_review: {
    pending: 'En espera',
    running: 'Transcribiendo letra...',
    awaiting: 'Revisá la letra transcrita',
    done: 'Letra aprobada',
    failed: 'No se pudo transcribir la letra',
  },
  sync: {
    pending: 'En espera',
    blocked: 'Arranca al aprobar la letra',
    running: 'Sincronizando letra con el audio...',
    done: 'Sincronía lista',
    failed: 'No se pudo sincronizar',
    stale: 'Desactualizado respecto a la letra',
  },
  pitch: {
    pending: 'En espera',
    blocked: 'Arranca al aprobar la letra',
    running: 'Calculando tono por sílaba...',
    done: 'Tono por sílaba listo',
    failed: 'No se pudo calcular el tono',
    stale: 'Desactualizado respecto a la letra',
  },
};

/**
 * @param {HTMLElement} container
 * @param {string} songId
 */
export function renderSongPipelineView(container, songId) {
  container.innerHTML = '';
  container.dataset.songId = songId;

  const view = document.createElement('div');
  view.className = 'pipeline-view';
  view.innerHTML = `
    <header class="pipeline-view__header">
      <button type="button" class="pipeline-view__back" aria-label="Volver">${icon('arrow-left')}</button>
      <h1 class="pipeline-view__title">Procesamiento</h1>
      <span class="pipeline-view__pill">0 de ${ROWS.length} fases</span>
    </header>
    <div class="pipeline-view__error" role="alert" hidden>
      <p class="pipeline-view__error-text">No se pudo cargar el procesamiento</p>
      <button type="button" class="pipeline-view__error-retry">Reintentar</button>
    </div>
    <div class="pipeline-view__rows"></div>
  `;
  container.appendChild(view);

  view.querySelector('.pipeline-view__back').addEventListener('click', () => goBack());

  // Botón de cancelar: NO vive en el HTML estático del header porque su
  // presencia depende del estado del run (CANCELABLE_RUN_STATUSES) — se crea
  // una sola vez acá y `updateCancelButton` lo inserta/retira del header en
  // cada render en vez de tocar solo un atributo `hidden`, para que un run ya
  // terminal no deje ni el botón en el DOM (evita el 404 destructivo del
  // endpoint si el admin lo clickea igual).
  const headerEl = view.querySelector('.pipeline-view__header');
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'pipeline-view__cancel';
  cancelBtn.setAttribute('aria-label', 'Cancelar procesamiento');
  cancelBtn.innerHTML = icon('ellipsis-vertical');
  cancelBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Cancelar procesamiento',
      body: 'Se perderá el progreso de este procesamiento. Esta acción no se puede deshacer.',
      confirmLabel: 'Cancelar procesamiento',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (!ok) return;
    try {
      await cancelPipelineRun(songId);
      showToast('Procesamiento cancelado');
      unsub?.refresh?.();
    } catch (err) {
      console.error('SongPipelineView: no se pudo cancelar el procesamiento', err);
      showToast(err.message || 'No se pudo cancelar el procesamiento', { type: 'error' });
    }
  });

  function updateCancelButton(run) {
    const cancelable = Boolean(run) && CANCELABLE_RUN_STATUSES.has(run.status);
    if (cancelable && !cancelBtn.isConnected) {
      headerEl.appendChild(cancelBtn);
    } else if (!cancelable && cancelBtn.isConnected) {
      cancelBtn.remove();
    }
  }

  const rowsEl = view.querySelector('.pipeline-view__rows');
  const pillEl = view.querySelector('.pipeline-view__pill');
  const errorEl = view.querySelector('.pipeline-view__error');
  // Ref compartida en vez de leer `unsub` (declarada más abajo) desde el
  // closure: evita depender de que el montaje corra sync antes del primer
  // click (un `return` temprano futuro en esta función rompería con TDZ).
  let unsub = null;
  view.querySelector('.pipeline-view__error-retry').addEventListener('click', () => {
    unsub?.refresh?.();
  });
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // El panel de letra (C3) es una factory async: se monta UNA sola vez
  // mientras el run esté en awaiting_lyrics y se reubica (sin recrear) en
  // cada re-render de filas, para no perder su estado interno (documento,
  // conflictos resueltos, scroll) en cada evento del watcher.
  let lyricsPanelEl = null;
  let lyricsPanelLoading = false;
  let lastRun = null;
  let destroyed = false;
  let lastSig = null;
  let firstRender = true;

  // Tarjeta de subida (D3b): mount-once igual que el panel de letra, para
  // no perder su máquina de estados local (validando/advertencia/subiendo)
  // en cada re-render de filas.
  const uploadCard = createUploadPhaseCard({
    songId,
    onAfterConfirm: () => {
      getPipelineRun(songId)
        .then((data) => renderPhases(data?.run ?? null))
        .catch((err) => {
          console.error('SongPipelineView: no se pudo refrescar el run tras confirmar', err);
        });
    },
  });

  // Detalle de Pistas (D3c): mount-once igual que el card de subida, para no
  // recrear el gestor de audio único (y su <audio> real) en cada re-render.
  const stemTracks = createStemTracksDetail({ songId });

  // Detalle de Secciones (Task 16): mount-once, mismo motivo (no perder el
  // <select>/foco del editor admin en cada re-render de filas). onChanged
  // refresca el run completo tras un PATCH exitoso, igual que
  // uploadCard.onAfterConfirm.
  const structureDetail = createStructureDetail({
    songId,
    onChanged: () => {
      getPipelineRun(songId)
        .then((data) => renderPhases(data?.run ?? null))
        .catch((err) => {
          console.error(
            'SongPipelineView: no se pudo refrescar el run tras editar la estructura',
            err,
          );
        });
    },
  });

  // Detalle de Sincronía (D3d): mount-once, mismo motivo (estado local de
  // línea expandida + mini-player propio del stem de voz). Esta vista no
  // tiene acceso a la canción proyectada, así que getSong cae al fallback
  // "Línea N"; getVocalsUrl lee siempre el run más reciente.
  const syncTuning = createSyncFineTuning({
    songId,
    getSong: () => null,
    getVocalsUrl: () => lastRun?.phases?.stems?.tracks?.vocals ?? null,
  });

  // Resumen transversal de baja confianza (Task 17): bloque ámbar bajo el
  // header, sobre el stepper. Conflictos/structureWarning llegan del `onData`
  // de LyricsReviewPanel (ver ensureLyricsPanel); timings de sync los trae el
  // propio componente (self-contained, mismo criterio que SyncFineTuning).
  let lyricsReviewData = { conflictsCount: 0, structureWarning: null };
  const confidenceSummary = createConfidenceSummary({
    songId,
    scrollToPhase: (phase) => {
      rowsEl
        .querySelector(`[data-phase="${phase}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  });
  view.insertBefore(confidenceSummary.el, rowsEl);

  async function ensureLyricsPanel() {
    if (lyricsPanelEl || lyricsPanelLoading) return;
    lyricsPanelLoading = true;
    try {
      lyricsPanelEl = await LyricsReviewPanel({
        songId,
        onApproved: () => {
          // El próximo evento del watcher (broadcast o polling) trae
          // lyrics_review en done y renderPhases suelta el panel solo.
        },
        onData: (data) => {
          // Task 17: reenvía conflictos/structureWarning al resumen
          // transversal en tiempo real (no espera al próximo tick del
          // polling de renderPhases, que puede saltarse por el guard de sig).
          lyricsReviewData = data;
          confidenceSummary.update(lastRun, lyricsReviewData);
        },
      });
    } catch (err) {
      console.error('SongPipelineView: no se pudo montar el panel de letra', err);
      // Sentinel de error: sin esto, cada poll de 3s reintenta la factory
      // indefinidamente (retry-storm) porque el catch no dejaba nada montado.
      const errorEl = document.createElement('p');
      errorEl.className = 'lrp__error';
      errorEl.textContent = 'No se pudo cargar la revisión de letra';
      lyricsPanelEl = errorEl;
    } finally {
      lyricsPanelLoading = false;
    }
    if (destroyed) return;
    // El panel (o su sentinel de error) recién quedó listo: es un cambio real
    // aunque la firma de status/phases no haya variado, así que forzamos el
    // rebuild invalidando la firma cacheada.
    lastSig = null;
    renderPhases(lastRun);
  }

  /** Calcula estado visual + copy + acción de una fase. */
  function describePhase(key, phase, runStatus, lyricsApproved) {
    const status = phase.status;
    const table = SUBTITLES[key];

    // 'structure' es best-effort (Task 16): un failed acá NUNCA ofrece
    // reintento (el endpoint api/songs/[id]/pipeline/retry.js ni siquiera lo
    // acepta, ver RETRYABLE_PHASES) — se pinta como 'pending' con el copy de
    // fallo para no alarmar con un dot ámbar que promete una acción que no
    // existe.
    if (key === 'structure' && status === 'failed') {
      return { state: 'pending', subtitle: table.failed };
    }

    if (status === 'stale') {
      return {
        state: 'stale',
        subtitle: table.stale,
        actionLabel: 'Re-procesar sincronía y tono',
        onRetry: async () => {
          try {
            await retryPipelinePhase(songId, 'sync');
            await retryPipelinePhase(songId, 'pitch');
          } catch (err) {
            console.error('SongPipelineView: no se pudo reprocesar sincronía y tono', err);
            showToast('No se pudo reintentar la fase. Intentá de nuevo.');
          }
        },
      };
    }

    if (status === 'failed') {
      return {
        state: 'failed',
        subtitle: table.failed,
        actionLabel: 'Reintentar fase',
        onRetry: async (k) => {
          try {
            await retryPipelinePhase(songId, k);
          } catch (err) {
            console.error('SongPipelineView: no se pudo reintentar la fase', err);
            showToast('No se pudo reintentar la fase. Intentá de nuevo.');
          }
        },
      };
    }

    if (status === 'running') {
      return { state: 'running', subtitle: table.running };
    }

    if (status === 'done') {
      // Letra aprobada: unica fase 'done' que admite reabrirse (Task 13,
      // robustez) — invalida en cascada sync/pitch/clips en el backend.
      if (key === 'lyrics_review') {
        return {
          state: 'done',
          subtitle: table.done,
          actionLabel: 'Editar letra',
          onRetry: async () => {
            const ok = await confirmDialog({
              title: 'Editar letra aprobada',
              body: 'Se recalcularán sincronía y tono por sílaba a partir de la letra editada. Esta acción no se puede deshacer.',
              confirmLabel: 'Editar letra',
              cancelLabel: 'Volver',
              danger: true,
            });
            if (!ok) return;
            try {
              await reopenLyrics(songId);
              showToast('Letra reabierta para edición');
              unsub?.refresh?.();
            } catch (err) {
              console.error('SongPipelineView: no se pudo reabrir la letra', err);
              showToast(err.message || 'No se pudo reabrir la letra', { type: 'error' });
            }
          },
        };
      }
      return { state: 'done', subtitle: table.done };
    }

    // pending: la fila Letra en awaiting_lyrics requiere acción del admin;
    // sync/pitch en pending quedan bloqueadas hasta aprobar la letra.
    if (key === 'lyrics_review' && runStatus === 'awaiting_lyrics') {
      return { state: 'act', subtitle: table.awaiting };
    }
    if ((key === 'sync' || key === 'pitch') && !lyricsApproved) {
      return { state: 'blocked', subtitle: table.blocked };
    }
    return { state: 'pending', subtitle: table.pending };
  }

  function renderPhases(run) {
    if (destroyed) return;
    lastRun = run;
    updateCancelButton(run);

    // Firma del estado relevante: si no cambió desde el último render, saltar
    // el rebuild. Evita desprender/reinsertar el nodo del panel de letra (y
    // que el input pierda foco) en cada tick del polling de 3s cuando lo
    // único que cambió fue contenido interno del documento de revisión.
    const sig = JSON.stringify({
      st: run?.status ?? null,
      ph: ['upload', 'stems', 'structure', 'lyrics_review', 'sync', 'pitch', 'clips'].map(
        (k) => run?.phases?.[k]?.status ?? null,
      ),
      tr: Object.keys(run?.phases?.stems?.tracks ?? {}).sort(),
      stc: (run?.structure?.segments ?? []).length,
    });
    if (sig === lastSig) return;
    lastSig = sig;

    rowsEl.innerHTML = '';

    // run puede ser null (sin procesamiento activo todavía): el stepper se
    // monta igual, con la fila Audio en su estado empty y el resto en espera.
    const phases = run?.phases || {};
    const lyricsApproved = phases.lyrics_review?.status === 'done';
    const doneCount = ROWS.filter((r) => phases[r.key]?.status === 'done').length;
    pillEl.textContent = `${doneCount} de ${ROWS.length} fases`;

    uploadCard.update(run);
    stemTracks.update(run);
    structureDetail.update(run);
    syncTuning.update(run);
    confidenceSummary.update(run, lyricsReviewData);

    ROWS.forEach((r, i) => {
      const phase = phases[r.key] || { status: 'pending' };
      const info = describePhase(r.key, phase, run?.status, lyricsApproved);

      let detail = null;
      if (r.key === 'upload') {
        detail = uploadCard.el;
      } else if (r.key === 'stems') {
        detail = stemTracks.el;
      } else if (r.key === 'structure') {
        detail = structureDetail.el;
      } else if (r.key === 'sync') {
        detail = syncTuning.el;
      } else if (r.key === 'lyrics_review') {
        if (run?.status === 'awaiting_lyrics' && phase.status !== 'done') {
          if (!lyricsPanelEl && !lyricsPanelLoading) ensureLyricsPanel();
          detail = lyricsPanelEl;
        } else {
          // Letra aprobada (u otro estado): soltar la referencia del panel.
          lyricsPanelEl = null;
        }
      }

      const row = PhaseRow({
        key: r.key,
        index: i + 1,
        title: r.title,
        subtitle: info.subtitle,
        state: info.state,
        error: phase.error || '',
        detail,
        actionLabel: info.actionLabel,
        onRetry: info.onRetry,
      });

      if (!reduceMotion && firstRender) {
        row.style.animationDelay = `${i * 40}ms`;
        row.classList.add('phase--enter');
      }

      rowsEl.appendChild(row);
    });

    firstRender = false;
  }

  /** Banner de error: NO borra las filas ya pintadas, solo se superpone. */
  function renderError() {
    if (destroyed) return;
    errorEl.hidden = false;
  }

  function clearError() {
    if (destroyed) return;
    errorEl.hidden = true;
  }

  // Esqueleto inmediato: las 5 filas se pintan con run=null antes de que el
  // watcher emita nada (primer refresh es async), para que la vista nunca
  // quede en blanco mientras esa promesa está en vuelo. Efecto secundario
  // intencional: esta llamada consume `firstRender`, así que la animación de
  // entrada `phase--enter` corre UNA sola vez acá, sobre el esqueleto vacío
  // (tipo skeleton loader) — no cuando llegan los datos reales del run.
  renderPhases(null);

  unsub = watchPipelineRun(songId, (data) => {
    if (data?.error) {
      renderError();
      return;
    }
    clearError();
    renderPhases(data?.run ?? null);
  });

  const offRoute = onRouteChange(() => {
    destroyed = true;
    unsub();
    offRoute();
    lyricsPanelEl = null;
    uploadCard.dispose?.();
    uploadCard.el.remove();
    stemTracks.destroy();
    structureDetail.destroy();
    syncTuning.destroy();
    confidenceSummary.destroy();
  });
}
