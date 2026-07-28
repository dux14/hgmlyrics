/**
 * SongPipelineView.js — vista admin "stepper" del procesamiento por canción
 * (pipeline unificado, plan D, Task D3a). Muestra las fases visibles (Audio,
 * Pistas, Secciones, Letra, Sincronía, Tono por sílaba, Clips por sección)
 * con estado progresivo vía `watchPipelineRun`. Esta sub-tarea es el
 * esqueleto: dot + copy + retry + stale + montaje del panel de letra (C3). El
 * detalle de Audio/Pistas/Sincronía lo montan D3b/D3c/D3d dentro del slot que
 * deja cada `PhaseRow`.
 */
import '../../styles/pipeline.css';
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';
import { goBack, onRouteChange } from '../../router.js';
import {
  watchPipelineRun,
  retryPipelinePhase,
  getPipelineRun,
  reopenLyrics,
  publishLyricsToSongbook,
} from '../../lib/pipelineApi.js';
import { showToast } from '../../lib/toast.js';
import { fetchSongDetail } from '../../lib/store.js';
import { getSongStudio } from '../../lib/studioApi.js';
import { confirmDialog } from '../ConfirmDialog.js';
import { LyricsReviewPanel } from './LyricsReviewPanel.js';
import { PhaseRow } from './PhaseRow.js';
import { createUploadPhaseCard } from './UploadPhaseCard.js';
import { createStemTracksDetail } from './StemTracksDetail.js';
import { createSyncFineTuning } from './SyncFineTuning.js';
import { createStructureDetail } from './StructureDetail.js';
import { createConfidenceSummary } from './ConfidenceSummary.js';

// Filas visibles del stepper, en orden. lyrics_review es la fase "Letra".
// 'structure' (Task 16) es best-effort (ver CRITICAL_PHASES en
// api/_lib/pipeline/state.js): nunca bloquea el run, así que no participa
// del gate de sync/pitch ni ofrece reintento (describePhase la trata aparte).
// 'clips' (#8, review): SÍ es CRITICAL_PHASES/RETRYABLE_PHASES en el backend
// y queda 'stale' tras editar la letra igual que sync/pitch — sin fila propia
// el run podía quedar sin llegar a 'done' sin que nada en pantalla lo
// explicara (la sub-línea de StemTracksDetail solo pinta el caso 'done').
const ROWS = [
  { key: 'upload', title: 'Audio' },
  { key: 'stems', title: 'Pistas' },
  { key: 'structure', title: 'Secciones' },
  { key: 'lyrics_review', title: 'Letra' },
  { key: 'sync', title: 'Sincronía' },
  { key: 'pitch', title: 'Tono por sílaba' },
  { key: 'clips', title: 'Clips por sección' },
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
    awaiting: 'Revisa la letra transcrita',
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
  clips: {
    pending: 'En espera',
    blocked: 'Arranca al aprobar la letra',
    running: 'Generando clips por sección...',
    done: 'Clips por sección listos',
    failed: 'No se pudieron generar los clips',
    stale: 'Desactualizado respecto a la letra',
  },
};

/** Botón "Publicar al cancionero" (F4): copia SOLO el texto de la letra
 * aprobada del pipeline a songs.sections (one-way, sin correr alignment — el
 * karaoke ya consume el store del pipeline directamente). Vive en el slot de
 * detalle de la fila Letra, separado del botón "Editar letra" (que usa el
 * único `actionLabel`/`onRetry` de PhaseRow). */
function createPublishToSongbookButton(songId) {
  const wrap = document.createElement('div');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'phase__action phase__action--secondary phase__publish-songbook';
  btn.textContent = 'Publicar al cancionero';
  btn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Publicar al cancionero',
      body: '¿Publicar esta letra al cancionero? Se reemplazará la letra actual de la canción con el texto del pipeline.',
      confirmLabel: 'Publicar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await publishLyricsToSongbook(songId);
      showToast('Letra publicada al cancionero');
    } catch (err) {
      console.error('SongPipelineView: no se pudo publicar la letra al cancionero', err);
      showToast(err.message || 'No se pudo publicar la letra al cancionero', { type: 'error' });
    }
  });
  wrap.appendChild(btn);
  return wrap;
}

/** m:ss de un extremo de tramo huérfano (Task 4.3), redondeado al segundo. */
function formatSpanTime(ms) {
  const totalSec = Math.round((ms ?? 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Filtra tramos malformados (fix review d6741d5, hallazgo 4): el dato viene
 * best-effort desde Modal, así que puede llegar con un elemento no-objeto
 * (rompería con TypeError al leer span.startMs) o con endMs < startMs
 * (se mostraría invertido, «2:22–2:10»). Descarta ambos casos. */
function getValidOrphanSpans(spans) {
  if (!Array.isArray(spans)) return [];
  return spans.filter(
    (span) =>
      span &&
      typeof span === 'object' &&
      Number.isFinite(span.startMs) &&
      Number.isFinite(span.endMs) &&
      span.endMs >= span.startMs,
  );
}

/** Texto del aviso de audio huérfano (Task 4.3): duración total en segundos
 * enteros (suma de los tramos) + el rango m:ss de cada tramo. Con más de un
 * tramo, los rangos van separados por coma para que se entienda cuántos son
 * y dónde está cada uno. */
function formatOrphanSpansWarning(spans) {
  const totalSec = Math.round(
    spans.reduce((sum, span) => sum + Math.max(0, (span.endMs ?? 0) - (span.startMs ?? 0)), 0) /
      1000,
  );
  const ranges = spans
    .map((span) => `${formatSpanTime(span.startMs)}–${formatSpanTime(span.endMs)}`)
    .join(', ');
  return `Hay ${totalSec} s con notas y sin letra aprobada (${ranges})`;
}

/** Aviso de audio huérfano (Task 4.3): tramos con notas cantadas sin letra
 * aprobada que los cubra, detectados best-effort por la app de pitch
 * (`analysis.warnings.orphanSpans`). Informa nada más -- la acción de
 * reabrir el gate de letra es la MISMA que ya define describePhase para la
 * fila Letra en estado 'done' ("Editar letra"), pasada por el llamador en
 * vez de duplicar su confirmación/reintento/toast. */
function createOrphanSpansWarning(spans, onReopenLyrics) {
  const wrap = document.createElement('div');
  wrap.className = 'phase__orphan-warning';
  const text = document.createElement('p');
  text.className = 'phase__orphan-warning-text';
  text.textContent = formatOrphanSpansWarning(spans);
  wrap.appendChild(text);
  if (typeof onReopenLyrics === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'phase__action phase__action--secondary';
    btn.textContent = 'Editar letra';
    btn.addEventListener('click', () => onReopenLyrics('lyrics_review'));
    wrap.appendChild(btn);
  }
  return wrap;
}

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
      <a class="pipeline-view__studio-link" href="#/song/${escapeHtml(songId)}/estudio">${icon('audio-lines', { size: 16 })}<span>Ver en Estudio</span></a>
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
  // A7: la letra aprobada vive en songs.sections (approveGate la escribe ahí
  // tras el auto-split), así que projectLines sobre esta copia calza 1:1 con
  // los índices de song_line_timings.lines[].i. lastLyricsDone detecta el
  // flanco pending→done del gate para refrescar la copia (queda stale tras
  // aprobar, porque el approve reescribe sections en el backend).
  let lastSong = null;
  let lastLyricsDone = null;

  // Task 4.3: tramos de audio con notas cantadas sin letra aprobada,
  // best-effort desde song_pitch_analysis.analysis.warnings.orphanSpans (el
  // GET del run no trae `analysis`, self-contained como confidenceSummary).
  // Se refetchea en el flanco pending/running/stale -> done de pitch y se
  // descarta si pitch deja de estar 'done' (run superado), mismo criterio
  // que ConfidenceSummary con timings.
  let orphanSpans = null;
  let lastPitchDone = null;
  // Fix review d6741d5, hallazgo 2: contador de generación para descartar
  // respuestas obsoletas. Dos flancos pending->done de pitch en la misma
  // sesión (reabrir y re-aprobar el gate dos veces) pueden disparar dos
  // fetches solapados; sin esto, uno viejo que resuelve después del más
  // nuevo pisaría orphanSpans con datos superados.
  let pitchAnalysisGen = 0;

  function refreshPitchAnalysis() {
    const gen = ++pitchAnalysisGen;
    getSongStudio(songId)
      .then((data) => {
        if (destroyed || gen !== pitchAnalysisGen) return;
        orphanSpans = data?.analysis?.warnings?.orphanSpans ?? null;
        lastSig = null;
        renderPhases(lastRun);
      })
      .catch((err) => {
        console.error('SongPipelineView: no se pudo cargar el análisis de tono', err);
      });
  }

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
  // línea expandida + mini-player propio del stem de voz). getSong lee
  // lastSong (canción fetcheada por refreshSong); getVocalsUrl lee siempre
  // el run más reciente.
  const syncTuning = createSyncFineTuning({
    songId,
    getSong: () => lastSong,
    getVocalsUrl: () => lastRun?.phases?.stems?.tracks?.vocals ?? null,
  });

  // A7: fetchea la canción (con sections) para que SyncFineTuning pueda
  // proyectar el texto real por línea en vez del fallback "Línea N". Se
  // dispara al montar y de nuevo cada vez que el gate de letra pasa a done
  // (ver renderPhases), porque el approve reescribe songs.sections.
  function refreshSong() {
    fetchSongDetail(songId).then((song) => {
      if (destroyed || !song) return;
      lastSong = song;
      // syncSongText() (no update()): el watcher del run suele ganar esta
      // carrera y consumir la transición pending→done de sync ANTES de que
      // este fetch resuelva, dejando update() sin nada que disparar (ver
      // becameDone en SyncFineTuning.js). syncSongText() repinta
      // incondicionalmente (respetando el guard de edición local) en vez de
      // depender de esa transición.
      syncTuning.syncSongText();
    });
  }
  refreshSong();

  // Resumen transversal de baja confianza (Task 17): bloque ámbar bajo el
  // header, sobre el stepper. Post-F3 la única fuente de items es la
  // sincronía; el propio componente la trae self-contained (mismo criterio
  // que SyncFineTuning).
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
    // Compartido por ambos catches de abajo (el interno de LyricsReviewPanel
    // y el de esta factory): suelta el sentinel cacheado y reintenta el
    // montaje. Sin esto el gate de letra quedaba muerto tras un fallo del
    // primer fetch, con recargar la página como única salida.
    const retry = () => {
      lyricsPanelEl = null;
      ensureLyricsPanel();
    };
    try {
      lyricsPanelEl = await LyricsReviewPanel({
        songId,
        onApproved: () => {
          // El próximo evento del watcher (broadcast o polling) trae
          // lyrics_review en done y renderPhases suelta el panel solo.
        },
        onRetry: retry,
      });
    } catch (err) {
      console.error('SongPipelineView: no se pudo montar el panel de letra', err);
      // Sentinel de error: sin esto, cada poll de 3s reintenta la factory
      // indefinidamente (retry-storm) porque el catch no dejaba nada montado.
      const errorEl = document.createElement('div');
      errorEl.innerHTML = `
        <p class="lrp__error">No se pudo cargar la revisión de letra</p>
        <button type="button" class="btn lrp__error-retry">Reintentar</button>
      `;
      errorEl.querySelector('.lrp__error-retry').addEventListener('click', retry);
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

    // 'structure' es best-effort (Task 16): un failed aquí NUNCA ofrece
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
        actionLabel: 'Re-procesar sincronía, tono y clips',
        onRetry: async () => {
          try {
            await retryPipelinePhase(songId, 'sync');
            await retryPipelinePhase(songId, 'pitch');
            await retryPipelinePhase(songId, 'clips');
          } catch (err) {
            console.error('SongPipelineView: no se pudo reprocesar sincronía, tono y clips', err);
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
    if ((key === 'sync' || key === 'pitch' || key === 'clips') && !lyricsApproved) {
      return { state: 'blocked', subtitle: table.blocked };
    }
    return { state: 'pending', subtitle: table.pending };
  }

  function renderPhases(run) {
    if (destroyed) return;
    lastRun = run;

    // A7: el approve del gate de letra reescribe songs.sections en el
    // backend — la copia local (lastSong) queda stale justo en el momento en
    // que sync más la necesita (arranca al aprobar). Detecta el flanco
    // pending→done y refetchea.
    const lyricsDone = run?.phases?.lyrics_review?.status === 'done';
    if (lyricsDone && lastLyricsDone === false) refreshSong();
    lastLyricsDone = lyricsDone;

    // Task 4.3: mismo flanco para el analisis de tono (orphanSpans).
    const pitchDone = run?.phases?.pitch?.status === 'done';
    if (pitchDone && lastPitchDone === false) refreshPitchAnalysis();
    if (!pitchDone) orphanSpans = null;
    lastPitchDone = pitchDone;

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
    confidenceSummary.update(run);

    // Task 4.3: la fila Letra (procesada antes que Tono en ROWS) es la única
    // que define el onRetry "Editar letra" de describePhase — se guarda para
    // reusarlo en el aviso de audio huérfano de la fila pitch, sin duplicar
    // confirmación/reopenLyrics/toast.
    let lyricsReopenAction = null;

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
        // Fix review d6741d5, hallazgo 1: capturar el onRetry SOLO cuando
        // lyrics_review está 'done' (única rama de describePhase que arma
        // "Editar letra" con confirmDialog + reopenLyrics + toast). Si el
        // estado es otro (p. ej. 'failed' por una carrera de webhook con
        // pitch todavía en 'done'), el onRetry sería el de reintentar la
        // fase — no depende del orden de ROWS, chequea phase.status directo.
        if (phase.status === 'done' && typeof info.onRetry === 'function') {
          lyricsReopenAction = info.onRetry;
        }
        if (run?.status === 'awaiting_lyrics' && phase.status !== 'done') {
          if (!lyricsPanelEl && !lyricsPanelLoading) ensureLyricsPanel();
          detail = lyricsPanelEl;
        } else {
          // Letra aprobada (u otro estado): soltar la referencia del panel.
          lyricsPanelEl = null;
          if (phase.status === 'done') detail = createPublishToSongbookButton(songId);
        }
      } else if (r.key === 'pitch') {
        const validSpans = getValidOrphanSpans(orphanSpans);
        if (validSpans.length > 0) {
          detail = createOrphanSpansWarning(validSpans, lyricsReopenAction);
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
  // entrada `phase--enter` corre UNA sola vez aquí, sobre el esqueleto vacío
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
