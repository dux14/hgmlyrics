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
 */
import '../../../styles/pipeline.css';
import { icon } from '../../../lib/icons.js';
import { escapeHtml } from '../../../lib/escape.js';
import { navigate, onRouteChange } from '../../../router.js';
import { fetchSongDetail } from '../../../lib/store.js';
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
  let sheetEl = null;

  const off = onRouteChange(() => {
    destroyed = true;
    off();
  });

  fetchSongDetail(songId).then((song) => {
    if (destroyed || !song?.title) return;
    subtitleEl.textContent = `${song.title} · ${stepLabel}`;
  });

  async function mountSheet() {
    try {
      sheetEl = await LyricsSheet({
        songId,
        onApproved: () => navigate(`/song/${songId}/procesamiento`),
        onRetry: () => {
          sheetEl = null;
          mountSheet();
        },
      });
    } catch (err) {
      console.error('LyricsSheetView: no se pudo montar la hoja de letra', err);
      const errorEl = document.createElement('div');
      errorEl.innerHTML = `
        <p class="lrp__error">No se pudo cargar la revisión de letra</p>
        <button type="button" class="btn lrp__error-retry">Reintentar</button>
      `;
      errorEl.querySelector('.lrp__error-retry').addEventListener('click', () => {
        sheetEl = null;
        mountSheet();
      });
      sheetEl = errorEl;
    }
    if (destroyed) return;
    bodyEl.innerHTML = '';
    bodyEl.appendChild(sheetEl);
  }

  mountSheet();
}
