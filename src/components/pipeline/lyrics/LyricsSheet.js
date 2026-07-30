/**
 * LyricsSheet.js — orquestador de la hoja viva de revisión de letra (S3a,
 * Task 8). Compone `SheetSection`/`SheetStatusStrip` (más `SheetLine` y
 * `SheetSeparator` por dentro de cada sección) y las repinta con `update(...)`
 * en vez de recrearlas — reemplaza el `innerHTML` completo por render de
 * el panel de revisión viejo, que perdía foco y scroll en cada acción.
 *
 * Migra sin reinventar tres piezas del panel viejo: la guarda `state.busy`
 * con lock inmediato de controles antes del PUT (el backend tiene CAS por
 * status, un segundo PUT en paralelo falla en silencio), `resync()` tras un
 * fallo de acción, y la animación de colapso `is-resolving` con fallback por
 * timeout + respeto de `prefers-reduced-motion`.
 *
 * Lo nuevo es el repintado por sección vía huella (`sectionFingerprint`) y el
 * caret calculado tras partir/unir, colocado con `SheetSection.focusLine`.
 *
 * S3b-ii suma el audio: `SheetAudio` monta la voz aislada (si `vocalsUrl`
 * llegó) en un contenedor fijo sobre el pie; `buildTimeline`/`activeAt`
 * (`sheetTiming.js`) traducen el tiempo del transporte al renglón o banda
 * instrumental que suena, y `handlers.listenFrom` salta ahí desde el botón
 * «Escuchar» de un renglón. La confirmación previa al approve deja de ser un
 * panel aparte (`LyricsPreviewStep`, retirado): es la misma hoja en modo
 * lectura (`state.readOnly`), con el transporte abierto de entrada.
 */
import '../../../styles/pipeline.css';
import { escapeHtml } from '../../../lib/escape.js';
import { icon } from '../../../lib/icons.js';
import { showToast } from '../../../lib/toast.js';
import { getLyricsReview, sendLyricsAction, approveLyrics } from '../../../lib/pipelineApi.js';
import { SCORE_THRESHOLD } from '../ConfidenceSummary.js';
import { SheetSection } from './SheetSection.js';
import { SheetStatusStrip } from './SheetStatusStrip.js';
import { SheetDrag } from './SheetDrag.js';
import { SheetAudio } from './SheetAudio.js';
import { buildTimeline, activeAt } from './sheetTiming.js';
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
 * @param {{songId: string, vocalsUrl?: string|null, durationMs?: number|null,
 *   onApproved?: () => void, onRetry?: () => void}} opts
 *   `onRetry` (opcional): si el primer fetch falla, se cuelga de un botón
 *   "Reintentar" en el estado de error — quien monta la hoja (SongPipelineView)
 *   lo usa para soltar su nodo cacheado y volver a invocar la factory.
 *   `vocalsUrl` (opcional): pista de voz aislada ya firmada
 *   (`run.phases.stems.tracks.vocals`, quien monta la hoja la trae de un
 *   `getPipelineRun` que ya hacía por su cuenta). Sin ella no hay chip
 *   «Escuchar» ni transporte: el run no publicó voz aislada todavía.
 * @returns {Promise<HTMLElement>}
 */
export async function LyricsSheet({
  songId,
  vocalsUrl = null,
  durationMs = null,
  onApproved,
  onRetry,
} = {}) {
  const el = document.createElement('div');
  el.className = 'sheet';

  let state;
  try {
    const initial = await getLyricsReview(songId);
    state = { ...initial, busy: false, previewOpen: false, dragging: false, readOnly: false };
  } catch (err) {
    el.innerHTML = `
      <p class="sheet__error">${escapeHtml(err.message || 'No se pudo cargar la revisión de letra')}</p>
      <button type="button" class="btn sheet__error-retry">Reintentar</button>
    `;
    el.querySelector('.sheet__error-retry').addEventListener('click', () => onRetry?.());
    el.destroy = () => {};
    return el;
  }

  el.innerHTML = `
    <div class="sheet__read-head" hidden>
      <h2 class="sheet__read-title">Confirmar el reparto de la letra</h2>
      <p class="sheet__read-hint">Revisa secciones, cortes y tiempos antes de aprobar.</p>
    </div>
    <div class="sheet__body"></div>
    <button type="button" class="btn2 sheet__add-section">${icon('plus', { size: 14 })}<span>Agregar sección</span></button>
    <div class="sheet__transport"></div>
    <div class="sheet__footer"></div>
  `;
  const readHeadEl = el.querySelector('.sheet__read-head');
  const bodyEl = el.querySelector('.sheet__body');
  const addSectionBtn = el.querySelector('.sheet__add-section');
  const transportEl = el.querySelector('.sheet__transport');
  const footerEl = el.querySelector('.sheet__footer');

  // Nodos vivos, alineados 1:1 por índice con state.review.sections — el
  // corazón del repintado por sección: solo se tocan cuando su huella (más
  // isLast e interpolated por renglón, que también afectan lo que se pinta)
  // cambió.
  const sectionNodes = [];
  const sectionKeys = [];

  // Cola de un solo elemento en vuelo para `persistText`: NO usa
  // `state.busy` (a propósito, para no bloquear la hoja mientras se tipea)
  // pero dos `SheetLine` distintos pueden bluerear casi a la vez —sin esto,
  // salían dos PUT de texto en paralelo y el backend, con CAS por status,
  // hacía fallar el segundo en silencio. Cada llamada se encadena a la
  // anterior en vez de disparar de una.
  let textQueue = Promise.resolve();

  function isBusy() {
    return state.busy || state.previewOpen || state.dragging;
  }

  /** El arrastre toma el mismo lock que las acciones de red: mientras un dedo
   * mueve un renglón, ningún otro control puede mutar el documento a espaldas
   * de los índices que el gesto ya midió. */
  function setDragging(flag) {
    state.dragging = flag;
    if (flag) lockControls();
    else unlockControls();
  }

  // Transporte de la voz aislada: SheetAudio ya sabe montar/renovar
  // MultiTrackPlayer con una sola pista. Sin vocalsUrl no se crea nada — ni
  // el chip de la tira de estado ni `handlers.listenFrom` se ofrecen
  // (SheetLine ya trae la guarda `typeof handlers.listenFrom === 'function'`).
  const audio = vocalsUrl
    ? SheetAudio({
        songId,
        url: vocalsUrl,
        onError: (msg) => showToast(msg, { type: 'error' }),
      })
    : null;
  if (audio) transportEl.appendChild(audio.el);

  // Timeline derivado de sections+timings (recalculado por sheetTiming.js en
  // cada respuesta de acción, ver rebuildTimeline) y nodo activo actual —
  // guardado, no buscado en el DOM en cada tick: onTime corre a 20 Hz.
  let timeline = buildTimeline(state.review.sections, state.timings, durationMs);
  let activeKey = null;

  function timingByLineForSection(sIdx) {
    const map = new Map();
    for (const e of timeline.entries) {
      if (e.sIdx === sIdx) map.set(e.lIdx, { startMs: e.startMs, interpolated: e.interpolated });
    }
    return map;
  }

  function timingKeyForSection(sIdx) {
    return timeline.entries
      .filter((e) => e.sIdx === sIdx)
      .map((e) => `${e.lIdx}:${e.interpolated ? 1 : 0}`)
      .join(',');
  }

  function sameActiveKey(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.sIdx === b.sIdx && a.lIdx === b.lIdx;
  }

  function setActiveNode(key, on) {
    if (!key) return;
    const node = sectionNodes[key.sIdx];
    if (!node) return;
    if (key.lIdx === null) node.setBandActive(on);
    else node.setLineActive(key.lIdx, on);
  }

  /** Conmuta la clase `is-sounding` entre el nodo activo anterior y el
   * nuevo — nunca repinta secciones, corre a la cadencia del transporte. */
  function applyActive(next) {
    if (sameActiveKey(activeKey, next)) return;
    setActiveNode(activeKey, false);
    setActiveNode(next, true);
    activeKey = next;
  }

  /** `SheetLine.renderReposo()` reconstruye `className` entero, así que
   * cualquier repintado de contenido (una acción, un remount de modo) borra
   * el `is-sounding` que `applyActive` había puesto — sin re-aplicar acá, el
   * resaltado desaparece hasta que el transporte cruce a OTRA ventana. */
  function reapplyActive() {
    const key = activeKey;
    activeKey = null;
    applyActive(key);
  }

  const unsubTime = audio?.onTime((sec) => applyActive(activeAt(timeline, sec * 1000)));

  /** El PUT/GET de la letra devuelve `timings` recalculado contra el
   * documento resultante — sin reconstruir el timeline acá, el resaltado y
   * `listenFrom` apuntarían a renglones que ya se movieron. */
  function rebuildTimeline() {
    timeline = buildTimeline(state.review.sections, state.timings, durationMs);
  }

  /** `handlers.listenFrom` (barra de acciones de `SheetLine`, S3b-i): abre
   * el transporte si estaba cerrado y salta al startMs del renglón — real o
   * interpolado, sin rama aparte. No se detiene al terminar el renglón: se
   * quiere oír cómo entra el siguiente. */
  function listenFrom(sIdx, lIdx) {
    const entry = timeline.entries.find((e) => e.sIdx === sIdx && e.lIdx === lIdx);
    if (!entry || !audio) return;
    audio.open();
    statusStrip.setListening(true);
    audio.seek(entry.startMs);
  }

  const handlers = { isBusy, runAction, persistText, moveLine, setDragging };
  if (audio) handlers.listenFrom = listenFrom;

  // Una sola instancia para toda la hoja: el grip se descubre por delegación,
  // así que los repintados por sección no exigen re-cablear el gesto.
  SheetDrag({ root: bodyEl, handlers });

  const statusStrip = SheetStatusStrip({
    doc: state.review,
    dudosoThreshold: SCORE_THRESHOLD,
    onJumpToDudoso: (sIdx, lIdx) => sectionNodes[sIdx]?.focusLine(lIdx),
    canListen: Boolean(audio),
    onToggleListen: () => {
      if (!audio) return;
      if (audio.isOpen()) {
        audio.close();
        statusStrip.setListening(false);
      } else {
        audio.open();
        statusStrip.setListening(true);
      }
    },
  });
  bodyEl.before(statusStrip);

  function updateApproveButtonState() {
    const approveBtn = footerEl.querySelector('.sheet__approve');
    if (approveBtn) approveBtn.disabled = !state.canApprove || isBusy();
  }

  // Marca el modo con el que se renderizó el pie por última vez — solo se
  // reconstruye entero al cruzar edición/lectura; el resto de los repintados
  // (cada acción) apenas refresca el idioma y el disabled del botón.
  let footerMode = null;

  /** Reconstruye el pie completo: edición (idioma + Aprobar letra) o lectura
   * (Volver a editar + Aprobar letra de verdad). Cambia el marco entero
   * (más `readHeadEl`/`addSectionBtn`, que son del mismo cruce), no el
   * contenido de las secciones. */
  function renderFooter() {
    footerMode = state.readOnly;
    readHeadEl.hidden = !state.readOnly;
    addSectionBtn.hidden = state.readOnly;
    if (state.readOnly) {
      footerEl.innerHTML = `
        <button type="button" class="btn2 sheet__back">${icon('arrow-left', { size: 14 })}<span>Volver a editar</span></button>
        <button type="button" class="btn sheet__confirm">Aprobar letra</button>
      `;
      footerEl.querySelector('.sheet__back').addEventListener('click', () => enterEdit());
      footerEl
        .querySelector('.sheet__confirm')
        .addEventListener('click', () => confirmApprove().catch(() => {}));
    } else {
      footerEl.innerHTML = `
        <select class="sheet__language-select" aria-label="Idioma de la letra">
          <option value="es">Español</option>
          <option value="en">Inglés</option>
        </select>
        <button type="button" class="btn sheet__approve">Aprobar letra</button>
      `;
      const languageSelect = footerEl.querySelector('.sheet__language-select');
      languageSelect.value = state.review.language ?? 'es';
      languageSelect.addEventListener('change', () => {
        runAction({ type: 'setLanguage', language: languageSelect.value }).catch(() => {});
      });
      footerEl
        .querySelector('.sheet__approve')
        .addEventListener('click', () => enterReadOnly().catch(() => {}));
    }
    updateApproveButtonState();
  }

  // Controles que `lockControls()` deshabilitó (los que YA estaban
  // deshabilitados antes de bloquear no entran acá) — `unlockControls()`
  // solo restaura estos. Sin esto, un botón que un `SheetLine` deshabilita
  // por su cuenta (p. ej. "Unir" cuando no hay vecino de ese lado, según la
  // posición del caret) quedaba rehabilitado a ciegas tras cualquier acción,
  // aunque su condición siguiera sin cumplirse.
  let lockedControls = null;

  /** Lock instantáneo de todos los controles interactivos habilitados, sin
   * esperar al repintado final — mismo motivo que el panel viejo: el
   * backend tiene CAS por status y una segunda request en paralelo puede
   * fallar en silencio. */
  function lockControls() {
    lockedControls = [];
    el.querySelectorAll('button, select, input, textarea').forEach((ctrl) => {
      if (ctrl.disabled) return;
      lockedControls.push(ctrl);
      ctrl.disabled = true;
    });
  }

  /** Contraparte de lockControls tras resolver: el repintado por sección deja
   * intactos (y por lo tanto bloqueados) los nodos de las secciones que no
   * cambiaron, así que hay que desbloquear explícitamente en vez de confiar
   * en que un render completo los reconstruya sin `disabled` — pero SOLO los
   * controles que lockControls() bloqueó, no todos: los que ya estaban
   * deshabilitados por su propia lógica quedan como estaban. */
  function unlockControls() {
    (lockedControls ?? []).forEach((ctrl) => {
      ctrl.disabled = false;
    });
    lockedControls = null;
    updateApproveButtonState();
  }

  /** Repinta las secciones: reusa el nodo por índice si la huella (+ isLast +
   * el interpolated de sus renglones, que cambia lo que se pinta) no varió,
   * actualiza si varió, agrega o quita nodos al final si cambió la cantidad.
   * `force` (usado por resync()) ignora la huella y repinta todo — tras un
   * fallo de acción el documento pudo cambiar por completo. */
  function syncSections({ force = false } = {}) {
    const sections = state.review.sections;
    const byLine = suggestionsByLine(state.suggestions);
    const textByLine = textSuggestionsByLine(state.textSuggestions);

    for (let i = 0; i < sections.length; i++) {
      const isLast = i === sections.length - 1;
      const key = `${sectionFingerprint(sections[i])}|${isLast ? 1 : 0}|${state.readOnly ? 1 : 0}|${timingKeyForSection(i)}`;
      if (sectionNodes[i]) {
        if (force || sectionKeys[i] !== key) {
          sectionNodes[i].update({
            section: sections[i],
            sIdx: i,
            isLast,
            byLine,
            textByLine,
            dudosoThreshold: SCORE_THRESHOLD,
            timingByLine: timingByLineForSection(i),
            readOnly: state.readOnly,
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
          timingByLine: timingByLineForSection(i),
          readOnly: state.readOnly,
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
    if (footerMode !== state.readOnly) {
      renderFooter();
    } else if (!state.readOnly) {
      const languageSelect = footerEl.querySelector('.sheet__language-select');
      if (languageSelect) languageSelect.value = state.review.language ?? 'es';
      updateApproveButtonState();
    }
  }

  /** Re-trae el documento del servidor tras un fallo de acción: el admin
   * nunca queda viendo un estado potencialmente viejo (mismo criterio que el
   * CAS del backend). Repinta TODO (force), no solo lo que cambió de huella.
   * Vuelve siempre a modo edición: un documento potencialmente distinto no
   * debe quedar mostrado como "reparto confirmado". */
  async function resync() {
    state.previewOpen = false;
    try {
      const fresh = await getLyricsReview(songId);
      // `dragging` se preserva en vez de reiniciarse: el resync puede llegar en
      // medio de un arrastre vivo (el `flushText()` con el que arranca el gesto
      // dispara un PUT que, al fallar, resincroniza por su cuenta). Perder el
      // flag aquí dejaría la hoja desbloqueada con un dedo todavía moviendo un
      // renglón, que es justo la ventana que el lock del arrastre cierra.
      state = {
        ...fresh,
        busy: false,
        previewOpen: false,
        dragging: state.dragging,
        readOnly: false,
      };
    } catch (err) {
      state.busy = false;
      showToast(err.message || 'No se pudo re-sincronizar la revisión. Recarga la página.', {
        type: 'error',
      });
    }
    rebuildTimeline();
    syncSections({ force: true });
    reapplyActive();
    unlockControls();
  }

  /** Todo `.sheet-line` montado, sin distinguir si está en edición — llamar
   * `.flushText()` en cada uno es idempotente (no-op si no hay texto sucio),
   * así que barrer todos es más simple y robusto que rastrear cuál está
   * editando ahora mismo. Secuencial, NO `Promise.all`: cada `flushText()`
   * que sí tiene texto sucio termina en un PUT (vía `persistText`, en la
   * misma cola de a uno) y dos en paralelo son exactamente el riesgo que esa
   * cola evita — barrerlos de a uno los deja ya serializados de entrada. */
  async function flushAllLines() {
    const lines = [...el.querySelectorAll('.sheet-line')];
    for (const node of lines) {
      await node.flushText?.();
    }
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
      // El renglón movido queda en toSection:toLine. Sin caret a propósito: se
      // ancla el foco sin reabrir la edición, así el chevrón siguiente sigue
      // operando sobre el mismo renglón.
      case 'moveLine':
        return { kind: 'line', section: action.toSection, line: action.toLine, caret: null };
      default:
        return null;
    }
  }

  /**
   * @param {{kind:string, section:number, line?:number, caret?:number|null}|null} hint
   * @param {HTMLElement|null} rowEl fila que disparó la acción (si la hubo) —
   *   fallback para las acciones de renglón sin caret conocido (insertLine,
   *   duplicateLine, toggleVocalization, deleteLine): `lockControls()`
   *   deshabilita el control recién clickeado y un elemento deshabilitado no
   *   retiene foco, así que sin esto el navegador lo manda a `<body>`.
   */
  function applyFocusHint(hint, rowEl = null) {
    if (hint) {
      const sections = state.review.sections;
      if (sections.length === 0) return;
      const sIdx = Math.min(Math.max(hint.section, 0), sections.length - 1);
      if (hint.kind === 'line') {
        const lineCount = sections[sIdx].lines.length;
        if (lineCount === 0) return;
        const lIdx = Math.min(Math.max(hint.line, 0), lineCount - 1);
        sectionNodes[sIdx]?.focusLine(lIdx, { caret: hint.caret ?? null });
      } else if (hint.kind === 'section') {
        sectionNodes[sIdx]?.querySelector('.sheet-section__name')?.focus({ preventScroll: true });
      }
      return;
    }
    // Sin hint calculado: si la fila que disparó la acción sigue en el DOM
    // (el repintado por sección la reusa desplazada, salvo que fuera la
    // última de su sección) se ancla ahí; si no, en la hoja entera — nunca
    // se deja caer el foco a `<body>` sin más.
    if (rowEl?.isConnected) {
      rowEl.tabIndex = -1;
      rowEl.focus({ preventScroll: true });
    } else if (rowEl) {
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
  }

  /** Traduce las dos acciones locales de chevrón al `moveLine` real. Vive aquí y
   * no en SheetLine porque los bordes de sección exigen el documento entero: el
   * primer renglón de una sección sube al FINAL de la anterior, y el último baja
   * al PRINCIPIO de la siguiente. Devuelve null cuando no hay a dónde ir (el
   * primer renglón de la primera sección, el último de la última). */
  function resolveLocalMove(action) {
    const sections = state.review.sections;
    const { section: sIdx, line: lIdx } = action;
    if (action.type === 'moveLineUp') {
      if (lIdx > 0) {
        return {
          type: 'moveLine',
          fromSection: sIdx,
          fromLine: lIdx,
          toSection: sIdx,
          toLine: lIdx - 1,
        };
      }
      const prev = sections[sIdx - 1];
      if (!prev) return null;
      return {
        type: 'moveLine',
        fromSection: sIdx,
        fromLine: lIdx,
        toSection: sIdx - 1,
        toLine: prev.lines.length,
      };
    }
    if (lIdx < sections[sIdx].lines.length - 1) {
      return {
        type: 'moveLine',
        fromSection: sIdx,
        fromLine: lIdx,
        toSection: sIdx,
        toLine: lIdx + 1,
      };
    }
    if (!sections[sIdx + 1]) return null;
    return {
      type: 'moveLine',
      fromSection: sIdx,
      fromLine: lIdx,
      toSection: sIdx + 1,
      toLine: 0,
    };
  }

  /**
   * Punto de entrada único de toda acción de edición: guarda de concurrencia
   * (`state.busy`/`previewOpen`), lock instantáneo, flush del renglón en
   * edición (excepto partir, que ya lleva el texto en su payload) y, si hay
   * `rowEl`, la animación de colapso antes del PUT.
   * @param {object} actionArg
   * @param {{rowEl?: HTMLElement|null}} [opts]
   */
  async function runAction(actionArg, { rowEl = null } = {}) {
    let action = actionArg;
    if (isBusy()) return;
    if (action.type === 'moveLineUp' || action.type === 'moveLineDown') {
      const resolved = resolveLocalMove(action);
      if (!resolved) return;
      action = resolved;
    }
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
      state.timings = result.timings ?? state.timings;
      rebuildTimeline();
      syncSections();
      reapplyActive();
      unlockControls();
      applyFocusHint(hint, rowEl);
    } catch (err) {
      state.busy = false;
      showToast(err.message || 'No se pudo aplicar el cambio', { type: 'error' });
      await resync();
    }
  }

  /** Persistencia de texto de renglón (blur/Cmd+Enter en SheetLine) — mismo
   * action.type que el `setLineText` de partir, pero llamado directo por
   * `SheetLine.flushText()`, sin pasar por runAction ni por el lock de
   * controles: no bloquea al resto de la hoja mientras se tipea. Encadenada
   * a `textQueue` en vez de disparar de una: `SheetLine.flushText()` ya
   * deduplica llamadas en simultáneo DENTRO del mismo renglón, pero nada
   * impide que dos renglones distintos bluereen casi a la vez — sin la cola,
   * salían dos PUT de texto en paralelo y el backend, con CAS por status,
   * fallaba el segundo en silencio. */
  function persistText(sIdx, lIdx, text) {
    const run = async () => {
      try {
        const result = await sendLyricsAction(songId, {
          type: 'setLineText',
          section: sIdx,
          line: lIdx,
          text,
        });
        state.review = result.review;
        state.canApprove = result.canApprove;
        state.timings = result.timings ?? state.timings;
        rebuildTimeline();
        syncSections();
        reapplyActive();
        updateApproveButtonState();
      } catch (err) {
        showToast(err.message || 'No se pudo guardar el texto', { type: 'error' });
        await resync();
      }
    };
    textQueue = textQueue.then(run);
    return textQueue;
  }

  /** Entrada del arrastre: recibe el payload ya convertido. `rowEl: null` a
   * propósito — el renglón no desaparece, se mueve, y el usuario ya vio el
   * gesto, así que la animación de colapso `is-resolving` sobraría. */
  function moveLine(payload) {
    if (!payload) return Promise.resolve();
    return runAction(payload, { rowEl: null });
  }

  /** Reconstruye TODAS las secciones desde cero: la conmutación de
   * `state.readOnly` no es un cambio de contenido (la huella no lo detecta
   * por sí sola) y puede dejar un `SheetLine` a mitad de edición — más
   * simple y robusto remontar entero que perseguir cada textarea abierto. */
  function remountSections() {
    bodyEl.innerHTML = '';
    sectionNodes.length = 0;
    sectionKeys.length = 0;
    syncSections();
  }

  /** Entra al modo lectura ("Aprobar letra" del pie de edición): mismo
   * mecanismo que runAction para el mismo riesgo — un click directo sin
   * desenfocar antes no debe mostrar `state.review` desactualizado, se
   * espera `flushAllLines()` primero. El transporte arranca abierto: es a
   * lo que se vino a esta pantalla. */
  async function enterReadOnly() {
    if (!state.canApprove || isBusy()) return;
    state.busy = true;
    lockControls();
    await flushAllLines();
    state.busy = false;
    if (!state.canApprove) {
      unlockControls();
      return;
    }
    state.readOnly = true;
    remountSections();
    reapplyActive();
    unlockControls();
    if (audio) {
      audio.open();
      statusStrip.setListening(true);
    }
  }

  /** "Volver a editar": conserva el documento local tal cual está, sin
   * refetch — solo cambia el marco. */
  function enterEdit() {
    if (isBusy()) return;
    // El transporte se abre solo al entrar a lectura, así que se cierra solo al
    // salir: si no, la voz sigue sonando sobre la hoja ya editable.
    if (audio) {
      audio.close();
      statusStrip.setListening(false);
    }
    state.readOnly = false;
    remountSections();
    reapplyActive();
    footerEl.querySelector('.sheet__approve')?.focus({ preventScroll: true });
  }

  async function confirmApprove() {
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
    runAction({ type: 'insertSection', at: state.review.sections.length }, { rowEl: null }).catch(
      () => {},
    );
  });

  syncSections();

  el.destroy = function destroy() {
    unsubTime?.();
    audio?.destroy();
  };

  return el;
}
