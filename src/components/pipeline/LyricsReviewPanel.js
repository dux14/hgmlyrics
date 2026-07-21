/**
 * LyricsReviewPanel.js — UI del gate humano de letra (pipeline unificado,
 * plan C, task C3). Consume `api/songs/:id/pipeline/lyrics` (plan C1/C2): el
 * admin ve el diff de 3 fuentes (transcripción AI / letra DB / letra
 * canónica) por sección, resuelve conflictos, decide vocalizaciones, ajusta
 * fraseo (dividir/unir renglones) y aprueba. El plan D (fuera de este scope)
 * monta este panel en la vista admin del run — este módulo no se importa
 * desde main.js/app.js, queda como chunk lazy.
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

/** Cantidad de conflictos + vocalizaciones sin decidir del documento. */
function pendingCount(review) {
  const conflicts = review.sections.reduce(
    (sum, s) => sum + s.lines.filter((l) => l.conflict).length,
    0,
  );
  const undecidedVocalizations = review.vocalizations.filter((v) => v.accepted === null).length;
  return conflicts + undecidedVocalizations;
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

function conflictCardHtml(line, sIdx, lIdx, disabled) {
  const hasCanonical = line.sources.canonical !== null && line.sources.canonical !== undefined;
  const dis = disabled ? ' disabled' : '';
  return `
    <div class="conf" data-section="${sIdx}" data-line="${lIdx}">
      <div class="old">${escapeHtml(line.sources.db)}</div>
      <div class="new">${escapeHtml(line.sources.canonical ?? line.sources.trans ?? '')}</div>
      <div class="conf__actions">
        ${
          hasCanonical
            ? `<button type="button" class="btn lrp__resolve" data-choice="canonical"${dis}>Usar canónica</button>`
            : ''
        }
        <button type="button" class="btn2 lrp__resolve" data-choice="db"${dis}>Mantener actual</button>
        <button type="button" class="btn2 lrp__edit-start"${dis}>Editar línea</button>
      </div>
    </div>`;
}

function vocalizationCardHtml(vocalization, vIdx, disabled) {
  const dis = disabled ? ' disabled' : '';
  return `
    <div class="voc" data-index="${vIdx}">
      <div class="lab">LA AI ESCUCHÓ ADEMÁS</div>
      <div class="voc__text">${escapeHtml(vocalization.text)}</div>
      <div class="voc__actions">
        <button type="button" class="btn2 lrp__voc-accept"${dis}>Agregar como vocalización</button>
        <button type="button" class="btn2 lrp__voc-reject"${dis}>Descartar</button>
      </div>
    </div>`;
}

/**
 * Índice de vocalizaciones pendientes por punto de anclaje ("sección:línea",
 * con línea -1 para "antes de cualquier línea de la sección 0").
 */
function vocalizationsByAnchor(vocalizations) {
  const byAnchor = new Map();
  vocalizations.forEach((v, idx) => {
    if (v.accepted !== null) return;
    const section = v.anchorAfterLine?.section ?? 0;
    const line = v.anchorAfterLine?.line ?? -1;
    const key = `${section}:${line}`;
    if (!byAnchor.has(key)) byAnchor.set(key, []);
    byAnchor.get(key).push({ vocalization: v, index: idx });
  });
  return byAnchor;
}

/** Índice de sugerencias de división por "sección:línea". */
function suggestionsByLine(suggestions) {
  const byLine = new Map();
  for (const s of suggestions) byLine.set(`${s.section}:${s.line}`, s.afterWords);
  return byLine;
}

/**
 * @param {{disabled: boolean, flash: {section:number, line:number}|null}} opts
 *   `disabled` bloquea los controles interactivos (acción en vuelo); `flash`
 *   marca con `.is-resolved` (motion) la línea recién resuelta, si cae en
 *   esta sección.
 */
function sectionHtml(section, sIdx, byAnchor, byLine, { disabled, flash } = {}) {
  const type = normalizeSectionType(section.type);
  const anchoredHere = byAnchor.get(`${sIdx}:-1`) || [];
  const topVocalizations = anchoredHere.map(({ vocalization, index }) =>
    vocalizationCardHtml(vocalization, index, disabled),
  );

  const linesHtml = section.lines
    .map((line, lIdx) => {
      const isFlash = flash && flash.section === sIdx && flash.line === lIdx;
      const lineHtml = line.conflict
        ? conflictCardHtml(line, sIdx, lIdx, disabled)
        : `<div class="lrp__line${isFlash ? ' is-resolved' : ''}" data-section="${sIdx}" data-line="${lIdx}">${lineTextWithSplits(line.text, byLine.get(`${sIdx}:${lIdx}`), disabled)}</div>`;
      const anchored = byAnchor.get(`${sIdx}:${lIdx}`) || [];
      const vocsHtml = anchored
        .map(({ vocalization, index }) => vocalizationCardHtml(vocalization, index, disabled))
        .join('');
      const mergeHtml =
        lIdx < section.lines.length - 1
          ? `<button type="button" class="lrp__merge" data-section="${sIdx}" data-line="${lIdx}"${disabled ? ' disabled' : ''}>Unir con el siguiente renglón</button>`
          : '';
      return `${lineHtml}${vocsHtml}${mergeHtml}`;
    })
    .join('');

  return `
    <div class="lrp__section">
      <div class="lrp__label section-${type}">${escapeHtml(SECTION_TYPE_LABELS[type] || type.toUpperCase())}</div>
      ${topVocalizations.join('')}
      ${linesHtml}
    </div>`;
}

/**
 * @param {{songId: string, onApproved?: () => void}} opts
 * @returns {Promise<HTMLElement>}
 */
export async function LyricsReviewPanel({ songId, onApproved } = {}) {
  const el = document.createElement('div');
  el.className = 'lrp';

  let state;
  try {
    const initial = await getLyricsReview(songId);
    state = { ...initial, busy: false };
  } catch (err) {
    el.innerHTML = `<p class="lrp__error">${escapeHtml(err.message || 'No se pudo cargar la revisión de letra')}</p>`;
    return el;
  }

  // Coordenadas {section, line} de la línea a resaltar con el flash
  // teal-soft 400ms en el PRÓXIMO render (se consume una sola vez, ver
  // render()). Solo resolve/acceptVocalization la fijan: son las únicas
  // acciones que "resuelven una tarjeta" según el spec de motion —
  // splitLine/mergeLines/rejectVocalization no llevan flash.
  let pendingFlash = null;

  /**
   * Lock instantáneo de los controles interactivos, sin esperar al render()
   * final: mientras hay un PUT/POST en vuelo (o corriendo la animación de
   * colapso previa) un doble click o dos acciones distintas dispararían
   * PUTs paralelos sobre el mismo documento — el backend tiene CAS por
   * status (`AND status='awaiting_lyrics'`), así que la 2a request puede
   * fallar en silencio si no se bloquea acá.
   */
  function lockControls() {
    el.querySelectorAll(
      '.lrp__resolve, .lrp__edit-start, .lrp__edit-save, .lrp__edit-cancel, .lrp__split, .lrp__merge, .lrp__voc-accept, .lrp__voc-reject, .lrp__approve',
    ).forEach((btn) => {
      btn.disabled = true;
    });
  }

  /**
   * Re-trae el documento del servidor tras un fallo de acción o de
   * aprobación: el admin nunca queda viendo un estado potencialmente viejo
   * sin más salida que recargar la página (mismo criterio que el CAS del
   * backend — si la acción falló porque el run ya no está en
   * awaiting_lyrics, esto lo refleja). También resuelve la staleness de
   * índices de startEdit: tras un resync, el documento en memoria vuelve a
   * estar al día.
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
    pendingFlash = null;
    render();
  }

  async function performAction(action, flashKey) {
    try {
      const result = await sendLyricsAction(songId, action);
      state = { ...state, ...result, busy: false };
      pendingFlash = flashKey;
      render();
    } catch (err) {
      showToast(err.message || 'No se pudo aplicar el cambio', { type: 'error' });
      await resync();
    }
  }

  /**
   * Punto de entrada único de toda acción de edición: guarda de
   * concurrencia (`state.busy`), lock instantáneo de controles y — si hay
   * `cardEl` (tarjeta de conflicto o vocalización) y reduce-motion no está
   * activo — colapso clip-path+fade 200ms de esa tarjeta antes de pintar el
   * resultado (spec motion). Sin `cardEl` (splitLine/mergeLines: no son
   * "tarjetas" que se resuelven) va directo a la acción, sin animar.
   * @param {object} action
   * @param {{cardEl?: HTMLElement|null, flashKey?: {section:number, line:number}|null}} [opts]
   */
  async function runAction(action, { cardEl = null, flashKey = null } = {}) {
    if (state.busy) return;
    state.busy = true;
    lockControls();
    if (cardEl && !reduceMotion()) {
      cardEl.classList.add('is-resolving');
      await waitForCollapse(cardEl);
    }
    await performAction(action, flashKey);
  }

  async function handleApprove() {
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

  function startEdit(confEl) {
    if (state.busy) return;
    const sIdx = Number(confEl.dataset.section);
    const lIdx = Number(confEl.dataset.line);
    const line = state.review.sections[sIdx].lines[lIdx];
    const actions = confEl.querySelector('.conf__actions');
    actions.innerHTML = `
      <input type="text" class="lrp__edit-input" value="${escapeHtml(line.sources.db)}" aria-label="Texto editado de la línea" />
      <button type="button" class="btn lrp__edit-save">Guardar</button>
      <button type="button" class="btn2 lrp__edit-cancel">Cancelar</button>`;
    actions.querySelector('.lrp__edit-cancel').addEventListener('click', () => render());
    actions.querySelector('.lrp__edit-save').addEventListener('click', () => {
      const text = actions.querySelector('.lrp__edit-input').value;
      if (!text.trim()) return;
      runAction(
        { type: 'resolve', section: sIdx, line: lIdx, choice: 'edit', text },
        { cardEl: confEl, flashKey: { section: sIdx, line: lIdx } },
      );
    });
  }

  function bind() {
    el.querySelectorAll('.lrp__resolve').forEach((btn) =>
      btn.addEventListener('click', () => {
        const conf = btn.closest('.conf');
        const sIdx = Number(conf.dataset.section);
        const lIdx = Number(conf.dataset.line);
        runAction(
          { type: 'resolve', section: sIdx, line: lIdx, choice: btn.dataset.choice },
          { cardEl: conf, flashKey: { section: sIdx, line: lIdx } },
        );
      }),
    );

    el.querySelectorAll('.lrp__edit-start').forEach((btn) =>
      btn.addEventListener('click', () => startEdit(btn.closest('.conf'))),
    );

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

    el.querySelectorAll('.voc').forEach((vocEl) => {
      const idx = Number(vocEl.dataset.index);
      const vocalization = state.review.vocalizations[idx];
      const section = vocalization.anchorAfterLine?.section ?? 0;
      const afterLine = vocalization.anchorAfterLine?.line ?? -1;
      vocEl
        .querySelector('.lrp__voc-accept')
        .addEventListener('click', () =>
          runAction(
            { type: 'acceptVocalization', index: idx, section, afterLine },
            { cardEl: vocEl, flashKey: { section, line: afterLine + 1 } },
          ),
        );
      vocEl
        .querySelector('.lrp__voc-reject')
        .addEventListener('click', () =>
          runAction({ type: 'rejectVocalization', index: idx }, { cardEl: vocEl }),
        );
    });

    el.querySelector('.lrp__approve')?.addEventListener('click', handleApprove);
  }

  /**
   * Restaura el foco tras cada render (el innerHTML completo se reemplaza
   * en cada pintura, así que sin esto el foco cae a <body> — regresión de
   * teclado). Orden de prioridad, de más a menos "lo próximo que el admin
   * querría hacer": siguiente conflicto pendiente > siguiente vocalización
   * pendiente > botón Aprobar (si ya se puede aprobar) > header (contenedor
   * con tabindex -1, último recurso cuando no queda nada interactivo
   * relevante — p.ej. recién montado con todo resuelto salvo Aprobar
   * deshabilitado por una acción en vuelo).
   */
  function restoreFocus() {
    const target =
      el.querySelector('.conf .lrp__resolve, .conf .btn2') ||
      el.querySelector('.voc .lrp__voc-accept') ||
      (state.canApprove ? el.querySelector('.lrp__approve') : null) ||
      el.querySelector('.lrp__header');
    target?.focus();
  }

  function render() {
    const byAnchor = vocalizationsByAnchor(state.review.vocalizations);
    const byLine = suggestionsByLine(state.suggestions || []);
    const pending = pendingCount(state.review);
    const motion = reduceMotion() ? '' : ' lrp--motion';
    const disabled = state.busy;
    const flash = pendingFlash;
    pendingFlash = null;

    el.className = `lrp${motion}`;
    el.innerHTML = `
      <div class="lrp__header" tabindex="-1">
        <span class="lrp__header-pending${pending === 0 ? ' is-done' : ''}">${
          pending === 0 ? 'Listo' : `${pending} pendiente${pending === 1 ? '' : 's'}`
        }</span>
        <span class="temp lrp__temp">${Math.round(state.temperature * 100)}%</span>
      </div>
      <div class="lrp__body">
        ${state.review.sections
          .map((s, i) => sectionHtml(s, i, byAnchor, byLine, { disabled, flash }))
          .join('')}
      </div>
      <div class="lrp__footer">
        <span class="lrp__pending">${pending} diferencia${pending === 1 ? '' : 's'} sin resolver</span>
        <button type="button" class="btn lrp__approve"${state.canApprove && !disabled ? '' : ' disabled'}>Aprobar letra</button>
      </div>`;
    bind();
    restoreFocus();
  }

  render();
  return el;
}
