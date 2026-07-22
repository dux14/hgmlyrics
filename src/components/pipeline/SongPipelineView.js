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
import { watchPipelineRun, retryPipelinePhase, getPipelineRun } from '../../lib/pipelineApi.js';
import { showToast } from '../../lib/toast.js';
import { LyricsReviewPanel } from './LyricsReviewPanel.js';
import { PhaseRow } from './PhaseRow.js';
import { createUploadPhaseCard } from './UploadPhaseCard.js';
import { createStemTracksDetail } from './StemTracksDetail.js';
import { createSyncFineTuning } from './SyncFineTuning.js';

// Filas visibles del stepper, en orden. lyrics_review es la fase "Letra".
const ROWS = [
  { key: 'upload', title: 'Audio' },
  { key: 'stems', title: 'Pistas' },
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
      <span class="pipeline-view__pill">0 de 5 fases</span>
    </header>
    <div class="pipeline-view__error" hidden>
      <p class="pipeline-view__error-text">No se pudo cargar el procesamiento</p>
      <button type="button" class="pipeline-view__error-retry">Reintentar</button>
    </div>
    <div class="pipeline-view__rows"></div>
  `;
  container.appendChild(view);

  view.querySelector('.pipeline-view__back').addEventListener('click', () => goBack());

  const rowsEl = view.querySelector('.pipeline-view__rows');
  const pillEl = view.querySelector('.pipeline-view__pill');
  const errorEl = view.querySelector('.pipeline-view__error');
  // El botón se resuelve antes de que `unsub` exista (se asigna al final de
  // la función), pero el click solo puede ocurrir después de que el montaje
  // termine, así que `unsub` ya está inicializado en ese momento.
  view.querySelector('.pipeline-view__error-retry').addEventListener('click', () => {
    unsub.refresh?.();
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

  // Detalle de Sincronía (D3d): mount-once, mismo motivo (estado local de
  // línea expandida + mini-player propio del stem de voz). Esta vista no
  // tiene acceso a la canción proyectada, así que getSong cae al fallback
  // "Línea N"; getVocalsUrl lee siempre el run más reciente.
  const syncTuning = createSyncFineTuning({
    songId,
    getSong: () => null,
    getVocalsUrl: () => lastRun?.phases?.stems?.tracks?.vocals ?? null,
  });

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

    // Firma del estado relevante: si no cambió desde el último render, saltar
    // el rebuild. Evita desprender/reinsertar el nodo del panel de letra (y
    // que el input pierda foco) en cada tick del polling de 3s cuando lo
    // único que cambió fue contenido interno del documento de revisión.
    const sig = JSON.stringify({
      st: run?.status ?? null,
      ph: ['upload', 'stems', 'lyrics_review', 'sync', 'pitch', 'clips'].map(
        (k) => run?.phases?.[k]?.status ?? null,
      ),
      tr: Object.keys(run?.phases?.stems?.tracks ?? {}).sort(),
    });
    if (sig === lastSig) return;
    lastSig = sig;

    rowsEl.innerHTML = '';

    // run puede ser null (sin procesamiento activo todavía): el stepper se
    // monta igual, con la fila Audio en su estado empty y el resto en espera.
    const phases = run?.phases || {};
    const lyricsApproved = phases.lyrics_review?.status === 'done';
    const doneCount = ROWS.filter((r) => phases[r.key]?.status === 'done').length;
    pillEl.textContent = `${doneCount} de 5 fases`;

    uploadCard.update(run);
    stemTracks.update(run);
    syncTuning.update(run);

    ROWS.forEach((r, i) => {
      const phase = phases[r.key] || { status: 'pending' };
      const info = describePhase(r.key, phase, run?.status, lyricsApproved);

      let detail = null;
      if (r.key === 'upload') {
        detail = uploadCard.el;
      } else if (r.key === 'stems') {
        detail = stemTracks.el;
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
    errorEl.hidden = true;
  }

  // Esqueleto inmediato: las 5 filas se pintan con run=null antes de que el
  // watcher emita nada (primer refresh es async), para que la vista nunca
  // quede en blanco mientras esa promesa está en vuelo.
  renderPhases(null);

  const unsub = watchPipelineRun(songId, (data) => {
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
    syncTuning.destroy();
  });
}
