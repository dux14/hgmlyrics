/**
 * LyricsReviewPanel.js — UI del gate humano de letra (pipeline unificado,
 * contrato v2, Task 3 del plan de migración). Editor puro sobre la salida de
 * la IA (transcripción + estructura, `buildReviewDoc`/`applyReviewAction` en
 * api/_lib/pipeline/lyricsReview.js): sin diff de 3 fuentes, sin conflictos,
 * sin temperatura — eso se eliminó en F2. El admin edita el documento
 * (partir/unir/mover/borrar renglones, retipar/renombrar secciones, alternar
 * vocalización) y aprueba. El pase visual (F5) es una fase posterior: este
 * componente conserva a propósito el CSS/estilo actual del panel. El plan D
 * (fuera de este scope) monta este panel en la vista admin del run — este
 * módulo no se importa desde main.js/app.js, queda como chunk lazy.
 *
 * Factory async: `await LyricsReviewPanel({ songId, onApproved })` trae el
 * documento de revisión y devuelve el nodo ya pintado (sin estado de carga
 * propio — quien lo monta decide cómo mostrar el intermedio async, igual que
 * cualquier otro fetch-antes-de-montar del repo).
 */
import '../../styles/pipeline.css';
import { escapeHtml } from '../../lib/escape.js';
import { icon } from '../../lib/icons.js';
import { showToast } from '../../lib/toast.js';
import { SECTION_TYPE_LABELS, normalizeSectionType } from '../../lib/sectionTypes.js';
import { getLyricsReview, sendLyricsAction, approveLyrics } from '../../lib/pipelineApi.js';
import { LyricsPreviewStep } from './LyricsPreviewStep.js';

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

/** `Math.round(confidence*100)%`, o `—` sin confidence (renglón sin words
 * alineadas — típico de vocalizaciones y ediciones manuales). */
function confidenceLabel(confidence) {
  if (typeof confidence !== 'number') return '—';
  return `${Math.round(confidence * 100)}%`;
}

/** Marca de tijera inline en el texto de una línea, en cada punto sugerido de corte. */
function lineTextWithSplits(text, afterWords, disabled) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!afterWords || afterWords.length === 0) return escapeHtml(text);
  const dis = disabled ? ' disabled' : '';
  let html = '';
  words.forEach((word, i) => {
    html += escapeHtml(word);
    if (afterWords.includes(i) && i < words.length - 1) {
      html += `<button type="button" class="lrp__split" data-after-word="${i}" aria-label="Partir línea después de «${escapeHtml(word)}»"${dis}>${icon('scissors', { size: 12 })}</button>`;
    }
    if (i < words.length - 1) html += ' ';
  });
  return html;
}

/** Opciones del `<select>` de retipado de sección, en el orden de SECTION_TYPE_LABELS. */
function sectionTypeOptionsHtml(currentType) {
  return Object.entries(SECTION_TYPE_LABELS)
    .map(
      ([slug, label]) =>
        `<option value="${slug}"${slug === currentType ? ' selected' : ''}>${escapeHtml(label)}</option>`,
    )
    .join('');
}

/** Índice de sugerencias de división por "sección:línea". */
function suggestionsByLine(suggestions) {
  const byLine = new Map();
  for (const s of suggestions) byLine.set(`${s.section}:${s.line}`, s.afterWords);
  return byLine;
}

/** Índice de propuestas de texto (semilla) por "sección:línea". */
function textSuggestionsByLine(textSuggestions) {
  const byLine = new Map();
  for (const s of textSuggestions ?? []) byLine.set(`${s.section}:${s.line}`, s);
  return byLine;
}

/** Fila de un renglón: texto (con tijeras de sugerencia) + badge de
 * confianza + botonera compacta (editar, vocalización, mover, borrar).
 * `canMoveUp`/`canMoveDown` deshabilitan los extremos globales del
 * documento (primer renglón de la primera sección, último de la última) —
 * dentro de eso `moveLine` siempre tiene un destino válido, cruce de
 * sección incluido (ver bind()).
 */
function lineRowHtml(
  line,
  sIdx,
  lIdx,
  afterWords,
  suggestion,
  { disabled, canMoveUp, canMoveDown },
) {
  const dis = disabled ? ' disabled' : '';
  const vocClass = line.vocalization ? ' lrp__line--vocalization' : '';
  return `
    <div class="lrp__line-row${vocClass}" data-section="${sIdx}" data-line="${lIdx}">
      <div class="lrp__line" data-section="${sIdx}" data-line="${lIdx}">${lineTextWithSplits(line.text, afterWords, disabled)}</div>
      <span class="lrp__conf" title="Confianza de transcripción">${confidenceLabel(line.confidence)}</span>
      <div class="lrp__line-actions">
        <button type="button" class="btn2 lrp__line-edit" aria-label="Editar renglón"${dis}>${icon('pencil', { size: 14 })}</button>
        <button type="button" class="btn2 lrp__line-voc${line.vocalization ? ' is-active' : ''}" aria-label="Alternar vocalización"${dis}>${icon('mic', { size: 14 })}</button>
        <button type="button" class="btn2 lrp__line-up" aria-label="Mover arriba"${dis}${canMoveUp ? '' : ' disabled'}>${icon('chevron-up', { size: 14 })}</button>
        <button type="button" class="btn2 lrp__line-down" aria-label="Mover abajo"${dis}${canMoveDown ? '' : ' disabled'}>${icon('chevron-down', { size: 14 })}</button>
        <button type="button" class="btn2 lrp__line-delete" aria-label="Borrar renglón"${dis}>${icon('trash', { size: 14 })}</button>
      </div>
      ${
        suggestion
          ? `
      <div class="lrp__suggest">
        <span class="lrp__suggest-text">${escapeHtml(suggestion.text)}</span>
        <button type="button" class="btn2 lrp__suggest-accept"${dis}>Usar este texto</button>
      </div>`
          : ''
      }
    </div>`;
}

/**
 * @param {{disabled: boolean}} opts `disabled` bloquea los controles
 *   interactivos (acción en vuelo).
 */
function sectionHtml(section, sIdx, byLine, textByLine, { disabled, isLast } = {}) {
  const type = normalizeSectionType(section.type);
  const dis = disabled ? ' disabled' : '';

  const linesHtml = section.lines
    .map((line, lIdx) => {
      const lineRow = lineRowHtml(
        line,
        sIdx,
        lIdx,
        byLine.get(`${sIdx}:${lIdx}`),
        textByLine.get(`${sIdx}:${lIdx}`),
        {
          disabled,
          canMoveUp: sIdx > 0 || lIdx > 0,
          canMoveDown: !isLast || lIdx < section.lines.length - 1,
        },
      );
      const mergeHtml =
        lIdx < section.lines.length - 1
          ? `<button type="button" class="lrp__merge" data-section="${sIdx}" data-line="${lIdx}"${dis}>Unir con el siguiente renglón</button>`
          : '';
      const sectionSplitHtml =
        lIdx < section.lines.length - 1
          ? `<button type="button" class="btn2 lrp__section-split" data-section="${sIdx}" data-line="${lIdx}"${dis}>Dividir aquí</button>`
          : '';
      return `${lineRow}${mergeHtml}${sectionSplitHtml}`;
    })
    .join('');

  const mergeSectionHtml = isLast
    ? ''
    : `<button type="button" class="btn2 lrp__section-merge" data-section="${sIdx}"${dis}>Unir con la siguiente sección</button>`;

  return `
    <div class="lrp__section">
      <div class="lrp__section-header">
        <select class="lrp__label lrp__type-select section-${type}" data-section="${sIdx}" aria-label="Tipo de sección"${dis}>
          ${sectionTypeOptionsHtml(type)}
        </select>
        <input type="text" class="lrp__rename-input" data-section="${sIdx}" value="${escapeHtml(section.label ?? '')}" placeholder="Nombre opcional" aria-label="Nombre de la sección"${dis} />
        ${mergeSectionHtml}
      </div>
      ${linesHtml}
    </div>`;
}

/**
 * @param {{songId: string, onApproved?: () => void}} opts
 * @param {{songId:string, onApproved:() => void, onRetry?: () => void}} opts
 *   `onRetry` (opcional): si el primer fetch falla, se cuelga de un botón
 *   "Reintentar" en el estado de error. Quien monta el panel (SongPipelineView)
 *   lo usa para soltar su caché de `lyricsPanelEl` y volver a invocar la
 *   factory — sin esto, el nodo de error quedaba cacheado para siempre y el
 *   gate de letra moría hasta recargar la página.
 * @returns {Promise<HTMLElement>}
 */
export async function LyricsReviewPanel({ songId, onApproved, onRetry } = {}) {
  const el = document.createElement('div');
  el.className = 'lrp';

  let state;
  try {
    const initial = await getLyricsReview(songId);
    state = { ...initial, busy: false };
  } catch (err) {
    el.innerHTML = `
      <p class="lrp__error">${escapeHtml(err.message || 'No se pudo cargar la revisión de letra')}</p>
      <button type="button" class="btn lrp__error-retry">Reintentar</button>
    `;
    el.querySelector('.lrp__error-retry').addEventListener('click', () => onRetry?.());
    return el;
  }

  /**
   * Lock instantáneo de los controles interactivos, sin esperar al render()
   * final: mientras hay un PUT/POST en vuelo (o corriendo la animación de
   * colapso previa) un doble click o dos acciones distintas dispararían
   * PUTs paralelos sobre el mismo documento — el backend tiene CAS por
   * status (`AND status='awaiting_lyrics'`), así que la 2a request puede
   * fallar en silencio si no se bloquea aquí.
   */
  function lockControls() {
    el.querySelectorAll(
      '.lrp__line-edit, .lrp__edit-save, .lrp__edit-cancel, .lrp__line-voc, .lrp__line-up, .lrp__line-down, .lrp__line-delete, .lrp__split, .lrp__merge, .lrp__approve, .lrp__type-select, .lrp__rename-input, .lrp__section-merge, .lrp__section-split, .lrp__suggest-accept, .lrp__language-select',
    ).forEach((btn) => {
      btn.disabled = true;
    });
  }

  /**
   * Re-trae el documento del servidor tras un fallo de acción o de
   * aprobación: el admin nunca queda viendo un estado potencialmente viejo
   * sin más salida que recargar la página (mismo criterio que el CAS del
   * backend — si la acción falló porque el run ya no está en
   * awaiting_lyrics, esto lo refleja).
   */
  async function resync() {
    try {
      const fresh = await getLyricsReview(songId);
      state = { ...fresh, busy: false };
    } catch (err) {
      state.busy = false;
      showToast(err.message || 'No se pudo re-sincronizar la revisión. Recargá la página.', {
        type: 'error',
      });
    }
    render();
  }

  async function performAction(action) {
    try {
      const result = await sendLyricsAction(songId, action);
      state = { ...state, ...result, busy: false };
      render();
    } catch (err) {
      showToast(err.message || 'No se pudo aplicar el cambio', { type: 'error' });
      await resync();
    }
  }

  /**
   * Punto de entrada único de toda acción de edición: guarda de
   * concurrencia (`state.busy`) y lock instantáneo de controles antes del
   * PUT. `rowEl` (fila de renglón que se está editando/borrando) anima un
   * colapso clip-path+fade 200ms antes de pintar el resultado, si
   * reduce-motion no está activo — mismo criterio que v1.
   * @param {object} action
   * @param {{rowEl?: HTMLElement|null}} [opts]
   */
  async function runAction(action, { rowEl = null } = {}) {
    if (state.busy || state.previewOpen) return;
    state.busy = true;
    state.focusHint = focusHintFor(action);
    lockControls();
    if (rowEl && !reduceMotion()) {
      rowEl.classList.add('is-resolving');
      await waitForCollapse(rowEl);
    }
    await performAction(action);
  }

  /** Pausa el `<audio>` del preview antes de quitarlo del DOM: sacar un
   * <audio> del árbol no detiene la reproducción por sí solo (mismo patrón
   * que `destroy()` en MultiTrackPlayer.js). */
  function pausePreviewAudio(preview) {
    preview?.querySelector('.lps__audio')?.pause();
  }

  /** Abre el paso de confirmación (Task 13): el approve nunca se dispara
   * directo desde el botón del panel, siempre pasa por el reparto final.
   * Bloquea el panel mientras el preview está abierto (`previewOpen`, leído
   * por runAction/startEditLine) para que editar detrás no lo destruya al
   * reemplazar `el.innerHTML` en el próximo render(); también evita abrir
   * un segundo `.lps` si ya hay uno montado. */
  function openPreview() {
    if (!state.canApprove || state.busy || state.previewOpen) return;
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
        el.querySelector('.lrp__approve')?.focus();
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
      onApproved?.();
      render();
    } catch (err) {
      showToast(err.message || 'No se pudo aprobar la letra', { type: 'error' });
      await resync();
    }
  }

  /** Autogrow del textarea de edición: arranca en un renglón exacto y crece
   * con el contenido (incluidos los `\n` que el admin tipea para partir). */
  function autogrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  /** Reemplaza el texto de la fila por un textarea editable + Guardar/Cancelar.
   * El textarea acepta `\n`: Enter lo inserta (comportamiento nativo, sin
   * guardar), Cmd/Ctrl+Enter guarda, Escape cancela. Un solo `setLineText`
   * con el texto completo — el dominio reparte el timing entre las piezas. */
  function startEditLine(rowEl) {
    if (state.busy || state.previewOpen) return;
    const sIdx = Number(rowEl.dataset.section);
    const lIdx = Number(rowEl.dataset.line);
    // Cancelar/Escape repinta el panel: sin el hint, el foco (y con él la
    // vista) volvería al primer renglón del documento.
    state.focusHint = { kind: 'line', section: sIdx, line: lIdx };
    const line = state.review.sections[sIdx].lines[lIdx];
    const lineEl = rowEl.querySelector('.lrp__line');
    lineEl.innerHTML = `
      <textarea class="lrp__edit-input" rows="1" aria-label="Texto editado del renglón">${escapeHtml(line.text)}</textarea>
      <button type="button" class="btn lrp__edit-save">Guardar</button>
      <button type="button" class="btn2 lrp__edit-cancel">Cancelar</button>
      <p class="lrp__edit-hint">Enter parte el renglón · Cmd/Ctrl+Enter guarda</p>`;
    const textarea = lineEl.querySelector('.lrp__edit-input');
    const save = () => {
      const text = textarea.value;
      if (!text.trim()) return;
      runAction({ type: 'setLineText', section: sIdx, line: lIdx, text }, { rowEl });
    };
    lineEl.querySelector('.lrp__edit-cancel').addEventListener('click', () => render());
    lineEl.querySelector('.lrp__edit-save').addEventListener('click', save);
    textarea.addEventListener('input', () => autogrow(textarea));
    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        render();
      } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        save();
      }
    });
    autogrow(textarea);
    textarea.focus();
  }

  /** Payload de moveLine para "mover arriba" — cruza a la sección anterior
   * (al final de ella) cuando el renglón ya es el primero de la suya. */
  function moveUpAction(sIdx, lIdx) {
    if (lIdx > 0) {
      return {
        type: 'moveLine',
        fromSection: sIdx,
        fromLine: lIdx,
        toSection: sIdx,
        toLine: lIdx - 1,
      };
    }
    const prevSection = state.review.sections[sIdx - 1];
    return {
      type: 'moveLine',
      fromSection: sIdx,
      fromLine: lIdx,
      toSection: sIdx - 1,
      toLine: prevSection.lines.length,
    };
  }

  /** Payload de moveLine para "mover abajo" — cruza a la siguiente sección
   * (al principio de ella) cuando el renglón ya es el último de la suya. */
  function moveDownAction(sIdx, lIdx, sectionLen) {
    if (lIdx < sectionLen - 1) {
      return {
        type: 'moveLine',
        fromSection: sIdx,
        fromLine: lIdx,
        toSection: sIdx,
        toLine: lIdx + 1,
      };
    }
    return { type: 'moveLine', fromSection: sIdx, fromLine: lIdx, toSection: sIdx + 1, toLine: 0 };
  }

  function bind() {
    el.querySelectorAll('.lrp__split').forEach((btn) =>
      btn.addEventListener('click', () => {
        const lineEl = btn.closest('.lrp__line');
        runAction({
          type: 'splitLine',
          section: Number(lineEl.dataset.section),
          line: Number(lineEl.dataset.line),
          afterWord: Number(btn.dataset.afterWord),
        });
      }),
    );

    el.querySelectorAll('.lrp__merge').forEach((btn) =>
      btn.addEventListener('click', () =>
        runAction({
          type: 'mergeLines',
          section: Number(btn.dataset.section),
          line: Number(btn.dataset.line),
        }),
      ),
    );

    el.querySelectorAll('.lrp__line-row').forEach((rowEl) => {
      const sIdx = Number(rowEl.dataset.section);
      const lIdx = Number(rowEl.dataset.line);

      rowEl.querySelector('.lrp__line-edit').addEventListener('click', () => startEditLine(rowEl));

      rowEl
        .querySelector('.lrp__line-voc')
        .addEventListener('click', () =>
          runAction({ type: 'toggleVocalization', section: sIdx, line: lIdx }, { rowEl }),
        );

      // El atributo `disabled` (extremos globales del documento, o acción en
      // vuelo) ya bloquea el click a nivel de browser/jsdom: el listener se
      // asocia igual, mismo patrón que el resto de los controles del panel.
      rowEl
        .querySelector('.lrp__line-up')
        .addEventListener('click', () => runAction(moveUpAction(sIdx, lIdx), { rowEl }));

      const sectionLen = state.review.sections[sIdx].lines.length;
      rowEl
        .querySelector('.lrp__line-down')
        .addEventListener('click', () =>
          runAction(moveDownAction(sIdx, lIdx, sectionLen), { rowEl }),
        );

      rowEl.querySelector('.lrp__line-delete').addEventListener('click', () => {
        if (!window.confirm('¿Borrar este renglón?')) return;
        runAction({ type: 'deleteLine', section: sIdx, line: lIdx }, { rowEl });
      });
    });

    el.querySelectorAll('.lrp__type-select').forEach((select) =>
      select.addEventListener('change', () =>
        runAction({
          type: 'setSectionType',
          section: Number(select.dataset.section),
          sectionType: normalizeSectionType(select.value),
        }),
      ),
    );

    el.querySelectorAll('.lrp__rename-input').forEach((input) =>
      input.addEventListener('change', () =>
        runAction({
          type: 'renameSection',
          section: Number(input.dataset.section),
          label: input.value.trim() === '' ? null : input.value.trim(),
        }),
      ),
    );

    el.querySelectorAll('.lrp__section-merge').forEach((btn) =>
      btn.addEventListener('click', () =>
        runAction({ type: 'mergeSections', section: Number(btn.dataset.section) }),
      ),
    );

    el.querySelectorAll('.lrp__section-split').forEach((btn) =>
      btn.addEventListener('click', () =>
        runAction({
          type: 'splitSection',
          section: Number(btn.dataset.section),
          afterLine: Number(btn.dataset.line),
        }),
      ),
    );

    el.querySelectorAll('.lrp__suggest-accept').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.lrp__line-row');
        const sIdx = Number(row.dataset.section);
        const lIdx = Number(row.dataset.line);
        const text = row.querySelector('.lrp__suggest-text').textContent;
        runAction({ type: 'editLine', section: sIdx, line: lIdx, text }, { rowEl: row });
      });
    });

    el.querySelector('.lrp__approve')?.addEventListener('click', openPreview);

    el.querySelector('.lrp__language-select')?.addEventListener('change', (ev) =>
      runAction({ type: 'setLanguage', language: ev.target.value }),
    );
  }

  /**
   * Scroller efectivo del panel: el ancestro con overflow scrollable, o el
   * documento. Se recalcula en cada render porque el panel se monta en
   * distintos contenedores según la vista que lo hospeda.
   */
  function findScroller() {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const overflowY = window.getComputedStyle?.(node).overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  /**
   * Ancla de foco tras el render: el control equivalente al que se acaba de
   * usar, no el primero del documento. Sin esto, editar el renglón 30 dejaba
   * el foco en el renglón 1 y el navegador arrastraba el scroll hasta arriba.
   */
  function focusHintFor(action) {
    switch (action.type) {
      case 'moveLine':
        return { kind: 'line', section: action.toSection, line: action.toLine };
      case 'setSectionType':
      case 'mergeSections':
      case 'splitSection':
        return { kind: 'sectionType', section: action.section };
      case 'renameSection':
        return { kind: 'sectionName', section: action.section };
      case 'setLanguage':
        return { kind: 'language' };
      default:
        return typeof action.section === 'number'
          ? { kind: 'line', section: action.section, line: action.line ?? 0 }
          : null;
    }
  }

  /** Resuelve el hint contra el DOM recién pintado; los índices pueden haber
   * quedado fuera de rango (borrar el último renglón, unir secciones), así
   * que cada caso degrada al control más cercano que sí exista. */
  function focusTargetFromHint(hint) {
    if (!hint) return null;
    if (hint.kind === 'language') return el.querySelector('.lrp__language-select');
    if (hint.kind === 'sectionType' || hint.kind === 'sectionName') {
      const cls = hint.kind === 'sectionType' ? 'lrp__type-select' : 'lrp__rename-input';
      return (
        el.querySelector(`.${cls}[data-section="${hint.section}"]`) ||
        el.querySelector(`.${cls}[data-section="${hint.section - 1}"]`)
      );
    }
    const rowIn = (section, line) =>
      el.querySelector(`.lrp__line-row[data-section="${section}"][data-line="${line}"]`);
    const row =
      rowIn(hint.section, hint.line) ||
      rowIn(hint.section, hint.line - 1) ||
      el.querySelector(`.lrp__line-row[data-section="${hint.section}"]`);
    return row?.querySelector('.lrp__line-edit') ?? null;
  }

  /**
   * Restaura el foco tras cada render (el innerHTML completo se reemplaza
   * en cada pintura, así que sin esto el foco cae a <body> — regresión de
   * teclado). Orden de prioridad: control de la última acción > primer
   * renglón editable > Aprobar (si ya se puede aprobar) > header (contenedor
   * con tabindex -1, último recurso). Siempre con `preventScroll`: el foco no
   * debe mover la vista, el admin se queda donde estaba editando.
   */
  function restoreFocus() {
    const target =
      focusTargetFromHint(state.focusHint) ||
      el.querySelector('.lrp__line-edit') ||
      (state.canApprove ? el.querySelector('.lrp__approve') : null) ||
      el.querySelector('.lrp__header');
    target?.focus({ preventScroll: true });
  }

  function render() {
    const scroller = findScroller();
    const scrollTop = scroller?.scrollTop ?? 0;
    const byLine = suggestionsByLine(state.suggestions || []);
    const textByLine = textSuggestionsByLine(state.textSuggestions);
    const motion = reduceMotion() ? '' : ' lrp--motion';
    const disabled = state.busy;

    el.className = `lrp${motion}`;
    el.innerHTML = `
      <div class="lrp__header" tabindex="-1">
        <h4 class="lrp__header-title">Revisión de letra</h4>
      </div>
      <div class="lrp__body">
        ${state.review.sections
          .map((s, i) =>
            sectionHtml(s, i, byLine, textByLine, {
              disabled,
              isLast: i === state.review.sections.length - 1,
            }),
          )
          .join('')}
      </div>
      <div class="lrp__footer">
        <select class="lrp__language-select" aria-label="Idioma de la letra"${disabled ? ' disabled' : ''}>
          <option value="es"${(state.review.language ?? 'es') === 'es' ? ' selected' : ''}>Español</option>
          <option value="en"${state.review.language === 'en' ? ' selected' : ''}>Inglés</option>
        </select>
        <button type="button" class="btn lrp__approve"${state.canApprove && !disabled ? '' : ' disabled'}>Aprobar letra</button>
      </div>`;
    bind();
    restoreFocus();
    // El repintado completo puede acortar el contenido por un instante y el
    // navegador clampa el scroll: se devuelve a donde estaba.
    if (scroller && scroller.scrollTop !== scrollTop) scroller.scrollTop = scrollTop;
  }

  render();
  return el;
}
