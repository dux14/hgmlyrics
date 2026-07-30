/**
 * LyricsSheet.js — orquestador de la hoja viva de revisión de letra (S3a,
 * Task 8). Compone `SheetSection`/`SheetStatusStrip` (más `SheetLine` y
 * `SheetSeparator` por dentro de cada sección) y las repinta con `update(...)`
 * en vez de recrearlas — reemplaza el `innerHTML` completo por render de
 * `LyricsReviewPanel.js`, que perdía foco y scroll en cada acción.
 *
 * Migra sin reinventar tres piezas del panel viejo: la guarda `state.busy`
 * con lock inmediato de controles antes del PUT (el backend tiene CAS por
 * status, un segundo PUT en paralelo falla en silencio), `resync()` tras un
 * fallo de acción, y la animación de colapso `is-resolving` con fallback por
 * timeout + respeto de `prefers-reduced-motion`.
 *
 * Lo nuevo es el repintado por sección vía huella (`sectionFingerprint`) y el
 * caret calculado tras partir/unir, colocado con `SheetSection.focusLine`.
 */
import '../../../styles/pipeline.css';
import { escapeHtml } from '../../../lib/escape.js';
import { icon } from '../../../lib/icons.js';
import { showToast } from '../../../lib/toast.js';
import { getLyricsReview, sendLyricsAction, approveLyrics } from '../../../lib/pipelineApi.js';
import { SCORE_THRESHOLD } from '../ConfidenceSummary.js';
import { LyricsPreviewStep } from '../LyricsPreviewStep.js';
import { SheetSection } from './SheetSection.js';
import { SheetStatusStrip } from './SheetStatusStrip.js';
import { sectionFingerprint } from './fingerprint.js';

const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
// Fallback si `transitionend` no llega (jsdom no corre transiciones, o el
// navegador tarda más de lo esperado): nunca deja la promesa colgada.
const COLLAPSE_FALLBACK_MS = 220;

function reduceMotion() {
  return window.matchMedia?.(REDUCE_MOTION_QUERY).matches ?? false;
}

/** Espera `transitionend` en `elm` o, si no llega, el timeout de respaldo. */
function waitForCollapse(elm) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      elm.removeEventListener('transitionend', finish);
      resolve();
    };
    elm.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, COLLAPSE_FALLBACK_MS);
  });
}

/** Índice de sugerencias de división por "sección:línea". */
function suggestionsByLine(suggestions) {
  const byLine = new Map();
  for (const s of suggestions ?? []) byLine.set(`${s.section}:${s.line}`, s.afterWords);
  return byLine;
}

/** Índice de propuestas de texto (semilla) por "sección:línea". */
function textSuggestionsByLine(textSuggestions) {
  const byLine = new Map();
  for (const s of textSuggestions ?? []) byLine.set(`${s.section}:${s.line}`, s);
  return byLine;
}

/**
 * @param {{songId: string, onApproved?: () => void, onRetry?: () => void}} opts
 *   `onRetry` (opcional): si el primer fetch falla, se cuelga de un botón
 *   "Reintentar" en el estado de error — quien monta la hoja (SongPipelineView)
 *   lo usa para soltar su nodo cacheado y volver a invocar la factory.
 * @returns {Promise<HTMLElement>}
 */
export async function LyricsSheet({ songId, onApproved, onRetry } = {}) {
  const el = document.createElement('div');
  el.className = 'sheet';

  let state;
  try {
    const initial = await getLyricsReview(songId);
    state = { ...initial, busy: false, previewOpen: false };
  } catch (err) {
    el.innerHTML = `
      <p class="sheet__error">${escapeHtml(err.message || 'No se pudo cargar la revisión de letra')}</p>
      <button type="button" class="btn sheet__error-retry">Reintentar</button>
    `;
    el.querySelector('.sheet__error-retry').addEventListener('click', () => onRetry?.());
    return el;
  }

  el.innerHTML = `
    <div class="sheet__body"></div>
    <button type="button" class="btn2 sheet__add-section">${icon('plus', { size: 14 })}<span>Agregar sección</span></button>
    <div class="sheet__footer">
      <select class="sheet__language-select" aria-label="Idioma de la letra">
        <option value="es">Español</option>
        <option value="en">Inglés</option>
      </select>
      <button type="button" class="btn sheet__approve">Aprobar letra</button>
    </div>
  `;
  const bodyEl = el.querySelector('.sheet__body');
  const addSectionBtn = el.querySelector('.sheet__add-section');
  const languageSelect = el.querySelector('.sheet__language-select');
  const approveBtn = el.querySelector('.sheet__approve');

  // Nodos vivos, alineados 1:1 por índice con state.review.sections — el
  // corazón del repintado por sección: solo se tocan cuando su huella (más
  // isLast, que también afecta el encabezado) cambió.
  const sectionNodes = [];
  const sectionKeys = [];

  function isBusy() {
    return state.busy || state.previewOpen;
  }

  const handlers = { isBusy, runAction, persistText };

  const statusStrip = SheetStatusStrip({
    doc: state.review,
    dudosoThreshold: SCORE_THRESHOLD,
    onJumpToDudoso: (sIdx, lIdx) => sectionNodes[sIdx]?.focusLine(lIdx),
  });
  bodyEl.before(statusStrip);

  function updateApproveButtonState() {
    approveBtn.disabled = !state.canApprove || isBusy();
  }

  /** Lock instantáneo de todos los controles interactivos, sin esperar al
   * repintado final — mismo motivo que el panel viejo: el backend tiene CAS
   * por status y una segunda request en paralelo puede fallar en silencio. */
  function lockControls() {
    el.querySelectorAll('button, select, input, textarea').forEach((ctrl) => {
      ctrl.disabled = true;
    });
  }

  /** Contraparte de lockControls tras resolver: el repintado por sección deja
   * intactos (y por lo tanto bloqueados) los nodos de las secciones que no
   * cambiaron, así que hay que desbloquear explícitamente en vez de confiar
   * en que un render completo los reconstruya sin `disabled`. */
  function unlockControls() {
    el.querySelectorAll('button, select, input, textarea').forEach((ctrl) => {
      ctrl.disabled = false;
    });
    updateApproveButtonState();
  }

  /** Repinta las secciones: reusa el nodo por índice si la huella (+ isLast,
   * que cambia el menú del encabezado) no varió, actualiza si varió, agrega
   * o quita nodos al final si cambió la cantidad. `force` (usado por
   * resync()) ignora la huella y repinta todo — tras un fallo de acción el
   * documento pudo cambiar por completo. */
  function syncSections({ force = false } = {}) {
    const sections = state.review.sections;
    const byLine = suggestionsByLine(state.suggestions);
    const textByLine = textSuggestionsByLine(state.textSuggestions);

    for (let i = 0; i < sections.length; i++) {
      const isLast = i === sections.length - 1;
      const key = `${sectionFingerprint(sections[i])}|${isLast ? 1 : 0}`;
      if (sectionNodes[i]) {
        if (force || sectionKeys[i] !== key) {
          sectionNodes[i].update({
            section: sections[i],
            sIdx: i,
            isLast,
            byLine,
            textByLine,
            dudosoThreshold: SCORE_THRESHOLD,
          });
        }
      } else {
        const node = SheetSection({
          section: sections[i],
          sIdx: i,
          isLast,
          byLine,
          textByLine,
          dudosoThreshold: SCORE_THRESHOLD,
          handlers,
        });
        sectionNodes[i] = node;
        bodyEl.appendChild(node);
      }
      sectionKeys[i] = key;
    }
    while (sectionNodes.length > sections.length) {
      sectionNodes.pop().remove();
      sectionKeys.pop();
    }

    statusStrip.update(state.review);
    languageSelect.value = state.review.language ?? 'es';
  }

  /** Re-trae el documento del servidor tras un fallo de acción: el admin
   * nunca queda viendo un estado potencialmente viejo (mismo criterio que el
   * CAS del backend). Repinta TODO (force), no solo lo que cambió de huella. */
  async function resync() {
    el.querySelector('.lps')?.remove();
    state.previewOpen = false;
    try {
      const fresh = await getLyricsReview(songId);
      state = { ...fresh, busy: false, previewOpen: false };
    } catch (err) {
      state.busy = false;
      showToast(err.message || 'No se pudo re-sincronizar la revisión. Recargá la página.', {
        type: 'error',
      });
    }
    syncSections({ force: true });
    unlockControls();
  }

  /** Todo `.sheet-line` montado, sin distinguir si está en edición — llamar
   * `.flushText()` en cada uno es idempotente (no-op si no hay texto sucio),
   * así que barrer todos es más simple y robusto que rastrear cuál está
   * editando ahora mismo. */
  async function flushAllLines() {
    const lines = [...el.querySelectorAll('.sheet-line')];
    await Promise.all(lines.map((node) => node.flushText?.()));
  }

  /** Ancla de foco tras una acción: el control equivalente al que se acaba
   * de usar. Caret calculado (no conservado) para partir y unir — el resto
   * de las acciones de sección ancla en el nombre; las de renglón sin
   * caret conocido no reabren edición (mismo criterio que el pencil-focus
   * del panel viejo, que tampoco forzaba edición). */
  function focusHintFor(action) {
    switch (action.type) {
      // Único action.type con el que runAction() recibe un split: ya trae el
      // texto completo (con el \n insertado) en el payload — ver
      // dispatchSplitAction en SheetLine.js. El renglón nuevo nace en
      // section:line+1, caret al offset 0.
      case 'setLineText':
        return { kind: 'line', section: action.section, line: action.line + 1, caret: 0 };
      // El renglón fusionado vive en action.section:action.line — capturar la
      // longitud del texto de arriba ANTES de mandar la acción, el documento
      // todavía no se mutó en este punto.
      case 'mergeLines': {
        const above = state.review.sections[action.section]?.lines[action.line];
        return {
          kind: 'line',
          section: action.section,
          line: action.line,
          caret: (above?.text ?? '').length,
        };
      }
      case 'setSectionType':
      case 'renameSection':
      case 'mergeSections':
      case 'duplicateSection':
      case 'deleteSection':
        return { kind: 'section', section: action.section };
      case 'splitSection':
        return { kind: 'section', section: action.section + 1 };
      case 'insertSection':
        return { kind: 'section', section: action.at };
      default:
        return null;
    }
  }

  function applyFocusHint(hint) {
    if (!hint) return;
    const sections = state.review.sections;
    if (sections.length === 0) return;
    const sIdx = Math.min(Math.max(hint.section, 0), sections.length - 1);
    if (hint.kind === 'line') {
      const lineCount = sections[sIdx].lines.length;
      if (lineCount === 0) return;
      const lIdx = Math.min(Math.max(hint.line, 0), lineCount - 1);
      sectionNodes[sIdx]?.focusLine(lIdx, { caret: hint.caret ?? null });
    } else if (hint.kind === 'section') {
      sectionNodes[sIdx]
        ?.querySelector('.sheet-section__name')
        ?.focus({ preventScroll: true });
    }
  }

  /**
   * Punto de entrada único de toda acción de edición: guarda de concurrencia
   * (`state.busy`/`previewOpen`), lock instantáneo, flush del renglón en
   * edición (excepto partir, que ya lleva el texto en su payload) y, si hay
   * `rowEl`, la animación de colapso antes del PUT.
   * @param {object} action
   * @param {{rowEl?: HTMLElement|null}} [opts]
   */
  async function runAction(action, { rowEl = null } = {}) {
    if (isBusy()) return;
    state.busy = true;
    const hint = focusHintFor(action);
    lockControls();
    if (action.type !== 'setLineText') {
      await flushAllLines();
    }
    if (rowEl && rowEl.isConnected && !reduceMotion()) {
      rowEl.classList.add('is-resolving');
      await waitForCollapse(rowEl);
    }
    try {
      const result = await sendLyricsAction(songId, action);
      state.busy = false;
      state.review = result.review;
      state.canApprove = result.canApprove;
      syncSections();
      unlockControls();
      applyFocusHint(hint);
    } catch (err) {
      state.busy = false;
      showToast(err.message || 'No se pudo aplicar el cambio', { type: 'error' });
      await resync();
    }
  }

  /** Persistencia de texto de renglón (blur/Cmd+Enter en SheetLine) — mismo
   * action.type que el `setLineText` de partir, pero llamado directo por
   * `SheetLine.flushText()`, sin pasar por runAction ni por el lock de
   * controles: el propio flushText de la línea deduplica llamadas en
   * simultáneo, y no bloquea al resto de la hoja mientras tipea. */
  async function persistText(sIdx, lIdx, text) {
    try {
      const result = await sendLyricsAction(songId, {
        type: 'setLineText',
        section: sIdx,
        line: lIdx,
        text,
      });
      state.review = result.review;
      state.canApprove = result.canApprove;
      syncSections();
      updateApproveButtonState();
    } catch (err) {
      showToast(err.message || 'No se pudo guardar el texto', { type: 'error' });
      await resync();
    }
  }

  /** Pausa el `<audio>` del preview antes de quitarlo del DOM: sacarlo del
   * árbol no detiene la reproducción por sí solo. */
  function pausePreviewAudio(preview) {
    preview?.querySelector('.lps__audio')?.pause();
  }

  /** Abre el paso de confirmación: el approve nunca se dispara directo desde
   * el botón de la hoja, siempre pasa por el reparto final. */
  function openPreview() {
    if (!state.canApprove || isBusy()) return;
    state.previewOpen = true;
    lockControls();
    const preview = LyricsPreviewStep({
      doc: state.review,
      vocalsUrl: state.vocalsUrl ?? null,
      onConfirm: confirmApprove,
      onBack: () => {
        pausePreviewAudio(preview);
        preview.remove();
        state.previewOpen = false;
        unlockControls();
        approveBtn.focus({ preventScroll: true });
      },
    });
    el.append(preview);
    preview.scrollIntoView?.({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    preview.focus?.();
  }

  async function confirmApprove() {
    const preview = el.querySelector('.lps');
    pausePreviewAudio(preview);
    preview?.remove();
    state.previewOpen = false;
    if (state.busy) return;
    state.busy = true;
    lockControls();
    try {
      await approveLyrics(songId);
      state.busy = false;
      unlockControls();
      onApproved?.();
    } catch (err) {
      showToast(err.message || 'No se pudo aprobar la letra', { type: 'error' });
      await resync();
    }
  }

  addSectionBtn.addEventListener('click', () => {
    runAction({ type: 'insertSection', at: state.review.sections.length }, { rowEl: null });
  });

  languageSelect.addEventListener('change', () => {
    runAction({ type: 'setLanguage', language: languageSelect.value });
  });

  approveBtn.addEventListener('click', openPreview);

  languageSelect.value = state.review.language ?? 'es';
  syncSections();
  updateApproveButtonState();

  return el;
}
