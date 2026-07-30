/**
 * LyricsSheetView.js — ruta propia de la hoja viva de revisión de letra
 * (S3a-ii, Task 1). Hasta acá `LyricsSheet` vivía montada dentro del slot de
 * detalle de la fila `lyrics_review` del stepper (`SongPipelineView.js`);
 * esta vista la saca de ahí con chrome propio (mismo patrón que
 * `SongStudioView.js`): header sticky con volver + título «Letra» +
 * subtítulo `<canción> · paso N de M`, y la hoja debajo.
 *
 * El `N de M` del subtítulo se deriva de `ROWS` (exportado por
 * `SongPipelineView.js`, la fuente única del orden de fases del stepper) en
 * vez de escribirse a mano: si el stepper suma o reordena una fase, este
 * subtítulo lo sigue sin tocar este archivo.
 *
 * Task 3 (estados de pantalla): antes, `LyricsSheet` solo se montaba cuando
 * el stepper ya sabía que la fase `lyrics_review` estaba en `awaiting_lyrics`
 * — nadie necesitaba distinguir "ya aprobada" de "error de carga" porque el
 * panel jamás se abría en esos casos. Con la ruta propia, `LyricsSheetView`
 * es alcanzable en cualquier estado del run (botón "Revisar letra" de
 * `createLyricsRowSummary`, navegación directa), así que ANTES de montar la
 * hoja editable esta vista consulta `getPipelineRun` para decidir qué
 * pantalla pintar: aprobada, divergente del cancionero, error de carga, o el
 * camino feliz (mounta `LyricsSheet`, que hace su propio fetch del
 * documento). No se interpreta el 404 de `GET .../pipeline/lyrics` para
 * distinguir "aprobada" de "error": el estado de la fase en el run
 * (`phases.lyrics_review.status === 'done'`) es la señal — ver notas.
 */
import '../../../styles/pipeline.css';
import { icon } from '../../../lib/icons.js';
import { escapeHtml } from '../../../lib/escape.js';
import { navigate, onRouteChange } from '../../../router.js';
import { fetchSongDetail } from '../../../lib/store.js';
import { getPipelineRun, reopenLyrics, publishLyricsToSongbook } from '../../../lib/pipelineApi.js';
import { confirmDialog } from '../../ConfirmDialog.js';
import { showToast } from '../../../lib/toast.js';
import { ROWS } from '../SongPipelineView.js';
import { LyricsSheet } from './LyricsSheet.js';

/**
 * @param {HTMLElement} container
 * @param {string} songId
 */
export function renderLyricsSheetView(container, songId) {
  container.innerHTML = '';
  container.dataset.songId = songId;

  const stepIndex = ROWS.findIndex((r) => r.key === 'lyrics_review');
  const stepLabel = `paso ${stepIndex + 1} de ${ROWS.length}`;

  const view = document.createElement('div');
  view.className = 'pipeline-view lyrics-sheet-view';
  view.innerHTML = `
    <header class="pipeline-view__header">
      <button type="button" class="pipeline-view__back" aria-label="Volver">${icon('arrow-left')}</button>
      <div class="pipeline-view__titles">
        <h1 class="pipeline-view__title">Letra</h1>
        <p class="pipeline-view__subtitle">${escapeHtml(stepLabel)}</p>
      </div>
    </header>
    <div class="lyrics-sheet-view__body"></div>
  `;
  container.appendChild(view);

  view
    .querySelector('.pipeline-view__back')
    .addEventListener('click', () => navigate(`/song/${songId}/procesamiento`));

  const subtitleEl = view.querySelector('.pipeline-view__subtitle');
  const bodyEl = view.querySelector('.lyrics-sheet-view__body');

  let destroyed = false;

  const off = onRouteChange(() => {
    destroyed = true;
    off();
  });

  fetchSongDetail(songId).then((song) => {
    if (destroyed || !song?.title) return;
    subtitleEl.textContent = `${song.title} · ${stepLabel}`;
  });

  /** Estado "no se pudo cargar" (fallo de `getPipelineRun`, p. ej. un 500):
   * mismo patrón visual (`.lrp__error` + `.lrp__error-retry`) que el
   * fallback de la propia `LyricsSheet` para un fallo dentro de la hoja. */
  function renderLoadError() {
    const el = document.createElement('div');
    el.innerHTML = `
      <p class="lrp__error">No se pudo cargar el estado de la letra</p>
      <button type="button" class="btn lrp__error-retry">Reintentar</button>
    `;
    el.querySelector('.lrp__error-retry').addEventListener('click', () => mountSheet());
    return el;
  }

  /** Letra ya aprobada (run con `phases.lyrics_review.status === 'done'`):
   * "Editar letra" reusa el mismo mecanismo que `describePhase` en
   * `SongPipelineView.js` (confirmDialog + `reopenLyrics` + toast) — reabrir
   * mueve el run a `awaiting_lyrics` y remonta, cayendo en el camino feliz
   * (`LyricsSheet` editable). "Publicar al cancionero" reimplementa el botón
   * de `createPublishToSongbookButton` de `SongPipelineView.js` (no
   * exportado desde ahí, fuera del alcance tocar ese archivo en esta tarea). */
  function renderApproved() {
    const el = document.createElement('div');
    el.className = 'lyrics-sheet-view__notice lyrics-sheet-view__notice--approved';
    el.innerHTML = `
      ${icon('triangle-alert', { size: 16, className: 'lyrics-sheet-view__notice-icon' })}
      <p class="lyrics-sheet-view__notice-text">Letra aprobada. Editarla recalcula sincronía y tono por sílaba.</p>
      <div class="lyrics-sheet-view__notice-actions">
        <button type="button" class="btn lyrics-sheet-view__edit">Editar letra</button>
        <button type="button" class="btn btn--secondary lyrics-sheet-view__publish">Publicar al cancionero</button>
      </div>
    `;
    el.querySelector('.lyrics-sheet-view__edit').addEventListener('click', async () => {
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
        mountSheet();
      } catch (err) {
        console.error('LyricsSheetView: no se pudo reabrir la letra', err);
        showToast(err.message || 'No se pudo reabrir la letra', { type: 'error' });
      }
    });
    el.querySelector('.lyrics-sheet-view__publish').addEventListener('click', async () => {
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
        console.error('LyricsSheetView: no se pudo publicar la letra al cancionero', err);
        showToast(err.message || 'No se pudo publicar la letra al cancionero', { type: 'error' });
      }
    });
    return el;
  }

  /** Divergencia (`run.lyricsDiverged`, calculado server-side en
   * `api/songs/[id]/pipeline.js` con `songbookDiverged`): la letra del
   * cancionero cambió después de aprobar esta. Sin pantalla de diferencias
   * en el front todavía (ver notas): "Ver diferencias" lleva al cancionero
   * (`/song/:id`), donde el admin ve el texto publicado hoy. */
  function renderDiverged() {
    const el = document.createElement('div');
    el.className = 'lyrics-sheet-view__notice lyrics-sheet-view__notice--diverged';
    el.innerHTML = `
      ${icon('triangle-alert', { size: 16, className: 'lyrics-sheet-view__notice-icon' })}
      <p class="lyrics-sheet-view__notice-text">La letra publicada en el cancionero cambió después de aprobar esta.</p>
      <div class="lyrics-sheet-view__notice-actions">
        <button type="button" class="btn lyrics-sheet-view__view-diff">Ver diferencias</button>
      </div>
    `;
    el.querySelector('.lyrics-sheet-view__view-diff').addEventListener('click', () => {
      navigate(`/song/${songId}`);
    });
    return el;
  }

  async function mountEditableSheet() {
    let sheetEl;
    try {
      sheetEl = await LyricsSheet({
        songId,
        onApproved: () => navigate(`/song/${songId}/procesamiento`),
        onRetry: () => mountSheet(),
      });
    } catch (err) {
      console.error('LyricsSheetView: no se pudo montar la hoja de letra', err);
      sheetEl = renderLoadError();
    }
    if (destroyed) return;
    bodyEl.innerHTML = '';
    bodyEl.appendChild(sheetEl);
  }

  async function mountSheet() {
    let runData;
    try {
      runData = await getPipelineRun(songId);
    } catch (err) {
      console.error('LyricsSheetView: no se pudo cargar el estado del procesamiento', err);
      if (destroyed) return;
      bodyEl.innerHTML = '';
      bodyEl.appendChild(renderLoadError());
      return;
    }
    if (destroyed) return;

    const run = runData?.run ?? null;
    if (run?.phases?.lyrics_review?.status === 'done') {
      bodyEl.innerHTML = '';
      bodyEl.appendChild(run.lyricsDiverged ? renderDiverged() : renderApproved());
      return;
    }

    await mountEditableSheet();
  }

  mountSheet();
}
