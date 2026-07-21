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

function reduceMotion() {
  return window.matchMedia?.(REDUCE_MOTION_QUERY).matches ?? false;
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
function lineTextWithSplits(text, afterWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!afterWords || afterWords.length === 0) return escapeHtml(text);
  let html = '';
  words.forEach((word, i) => {
    html += escapeHtml(word);
    if (afterWords.includes(i) && i < words.length - 1) {
      html += `<button type="button" class="lrp__split" data-after-word="${i}" aria-label="Partir línea después de «${escapeHtml(word)}»">${icon('scissors', { size: 12 })}</button>`;
    }
    if (i < words.length - 1) html += ' ';
  });
  return html;
}

function conflictCardHtml(line, sIdx, lIdx) {
  const hasCanonical = line.sources.canonical !== null && line.sources.canonical !== undefined;
  return `
    <div class="conf" data-section="${sIdx}" data-line="${lIdx}">
      <div class="old">${escapeHtml(line.sources.db)}</div>
      <div class="new">${escapeHtml(line.sources.canonical ?? line.sources.trans ?? '')}</div>
      <div class="conf__actions">
        ${
          hasCanonical
            ? `<button type="button" class="btn lrp__resolve" data-choice="canonical">Usar canónica</button>`
            : ''
        }
        <button type="button" class="btn2 lrp__resolve" data-choice="db">Mantener actual</button>
        <button type="button" class="btn2 lrp__edit-start">Editar línea</button>
      </div>
    </div>`;
}

function vocalizationCardHtml(vocalization, vIdx) {
  return `
    <div class="voc" data-index="${vIdx}">
      <div class="lab">LA AI ESCUCHÓ ADEMÁS</div>
      <div class="voc__text">${escapeHtml(vocalization.text)}</div>
      <div class="voc__actions">
        <button type="button" class="btn2 lrp__voc-accept">Agregar como vocalización</button>
        <button type="button" class="btn2 lrp__voc-reject">Descartar</button>
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

function sectionHtml(section, sIdx, byAnchor, byLine) {
  const type = normalizeSectionType(section.type);
  const anchoredHere = byAnchor.get(`${sIdx}:-1`) || [];
  const topVocalizations = anchoredHere.map(({ vocalization, index }) =>
    vocalizationCardHtml(vocalization, index),
  );

  const linesHtml = section.lines
    .map((line, lIdx) => {
      const lineHtml = line.conflict
        ? conflictCardHtml(line, sIdx, lIdx)
        : `<div class="lrp__line" data-section="${sIdx}" data-line="${lIdx}">${lineTextWithSplits(line.text, byLine.get(`${sIdx}:${lIdx}`))}</div>`;
      const anchored = byAnchor.get(`${sIdx}:${lIdx}`) || [];
      const vocsHtml = anchored
        .map(({ vocalization, index }) => vocalizationCardHtml(vocalization, index))
        .join('');
      const mergeHtml =
        lIdx < section.lines.length - 1
          ? `<button type="button" class="lrp__merge" data-section="${sIdx}" data-line="${lIdx}">Unir con el siguiente renglón</button>`
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
    state = await getLyricsReview(songId);
  } catch (err) {
    el.innerHTML = `<p class="lrp__error">${escapeHtml(err.message || 'No se pudo cargar la revisión de letra')}</p>`;
    return el;
  }

  function applyResult(result) {
    state = { ...state, ...result };
    render();
  }

  async function runAction(action) {
    try {
      const result = await sendLyricsAction(songId, action);
      applyResult(result);
    } catch (err) {
      showToast(err.message || 'No se pudo aplicar el cambio', { type: 'error' });
    }
  }

  async function handleApprove() {
    const btn = el.querySelector('.lrp__approve');
    if (btn) btn.disabled = true;
    try {
      await approveLyrics(songId);
      onApproved?.();
    } catch (err) {
      showToast(err.message || 'No se pudo aprobar la letra', { type: 'error' });
      if (btn) btn.disabled = !state.canApprove;
    }
  }

  function startEdit(confEl) {
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
      runAction({ type: 'resolve', section: sIdx, line: lIdx, choice: 'edit', text });
    });
  }

  function bind() {
    el.querySelectorAll('.lrp__resolve').forEach((btn) =>
      btn.addEventListener('click', () => {
        const conf = btn.closest('.conf');
        runAction({
          type: 'resolve',
          section: Number(conf.dataset.section),
          line: Number(conf.dataset.line),
          choice: btn.dataset.choice,
        });
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
      vocEl.querySelector('.lrp__voc-accept').addEventListener('click', () =>
        runAction({
          type: 'acceptVocalization',
          index: idx,
          section: vocalization.anchorAfterLine?.section ?? 0,
          afterLine: vocalization.anchorAfterLine?.line ?? -1,
        }),
      );
      vocEl
        .querySelector('.lrp__voc-reject')
        .addEventListener('click', () => runAction({ type: 'rejectVocalization', index: idx }));
    });

    el.querySelector('.lrp__approve')?.addEventListener('click', handleApprove);
  }

  function render() {
    const byAnchor = vocalizationsByAnchor(state.review.vocalizations);
    const byLine = suggestionsByLine(state.suggestions || []);
    const pending = pendingCount(state.review);
    const motion = reduceMotion() ? '' : ' lrp--motion';

    el.className = `lrp${motion}`;
    el.innerHTML = `
      <div class="lrp__header">
        <span class="temp lrp__temp">${Math.round(state.temperature * 100)}%</span>
      </div>
      <div class="lrp__body">
        ${state.review.sections.map((s, i) => sectionHtml(s, i, byAnchor, byLine)).join('')}
      </div>
      <div class="lrp__footer">
        <span class="lrp__pending">${pending} diferencia${pending === 1 ? '' : 's'} sin resolver</span>
        <button type="button" class="btn lrp__approve"${state.canApprove ? '' : ' disabled'}>Aprobar letra</button>
      </div>`;
    bind();
  }

  render();
  return el;
}
