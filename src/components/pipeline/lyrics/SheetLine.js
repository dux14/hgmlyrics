/**
 * SheetLine.js — un renglón de la hoja viva de revisión de letra (S3a).
 * Factory que devuelve `div.sheet-line`; el orquestador (`LyricsSheet`, Task
 * 8) lo repinta con `update(...)` en vez de recrearlo.
 *
 * Reposo (Task 2): tres estados — con texto, sin texto («Sin texto»,
 * confianza apagada) y vocalización (itálica atenuada, sin barra de
 * confianza). El handle de arrastre se pinta pero es inerte: el gesto de
 * reordenar es de la sesión 4.
 *
 * Edición (Task 3): un toque en el texto abre un textarea in-place más la
 * barra Partir · Unir · Duplicar · Voc. · Borrar debajo, sin Guardar ni
 * Cancelar — el guardado de texto es implícito (blur) y las acciones de
 * estructura viajan por `handlers.runAction`.
 */
import { icon } from '../../../lib/icons.js';
import { escapeHtml } from '../../../lib/escape.js';

const EMPTY_TEXT = 'Sin texto';

/** True si el renglón tiene words alineadas y una confidence numérica —
 * únicas condiciones bajo las que se pinta la barra de confianza llena. */
function hasConfidence(line) {
  return Array.isArray(line.words) && line.words.length > 0 && typeof line.confidence === 'number';
}

/** Offset de caracteres en `text` justo después de la palabra `wordIdx`
 * (palabras separadas por un único espacio) — usado para llevar el caret del
 * textarea al punto de una tijera de sugerencia. */
function offsetAfterWord(text, wordIdx) {
  const words = text.split(/\s+/).filter(Boolean);
  let offset = 0;
  for (let i = 0; i <= wordIdx && i < words.length; i++) {
    offset += words[i].length;
    if (i < wordIdx) offset += 1;
  }
  return offset;
}

/** Marcado de las tijeras de corte sugerido sobre el texto — solo se pinta
 * en edición (fuera del textarea, que no admite HTML inline). */
function scissorsHtml(text, afterWords) {
  if (!afterWords || afterWords.length === 0) return '';
  const words = text.split(/\s+/).filter(Boolean);
  let html = '';
  words.forEach((word, i) => {
    html += escapeHtml(word);
    if (afterWords.includes(i) && i < words.length - 1) {
      html += `<button type="button" class="sheet-line__scissor" data-after-word="${i}" aria-label="Ir al corte tras «${escapeHtml(word)}»">${icon('scissors', { size: 12 })}</button>`;
    }
    if (i < words.length - 1) html += ' ';
  });
  return `<div class="sheet-line__scissors">${html}</div>`;
}

/** Autogrow del textarea de edición — mismo criterio que autogrow() en
 * LyricsReviewPanel.js. */
function autogrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * @param {{line: object, sIdx: number, lIdx: number, afterWords?: number[],
 *   suggestion?: object|null, isDudoso?: boolean, canMoveUp?: boolean,
 *   canMoveDown?: boolean, handlers: object}} opts
 * @returns {HTMLElement}
 */
export function SheetLine(opts) {
  const { sIdx, lIdx, handlers } = opts;
  let { line, afterWords, suggestion, isDudoso, canMoveUp, canMoveDown } = opts;

  const el = document.createElement('div');
  el.className = 'sheet-line';

  let editing = false;
  // Texto de referencia al abrir edición: flushText() solo persiste si el
  // valor del textarea difiere de este — guardar vacío está permitido a
  // propósito, no se replica el `if (!text.trim()) return;` del panel viejo.
  let originalText = null;
  // Caret pedido por openEdit({ caret }) para el próximo render de edición;
  // se consume una sola vez.
  let pendingCaret = null;

  function renderReposo() {
    const isEmpty = !line.text;
    const isVoc = !!line.vocalization;
    el.className = [
      'sheet-line',
      isEmpty ? 'sheet-line--empty' : '',
      isVoc ? 'sheet-line--vocalization' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const confHtml = isVoc
      ? ''
      : `<span class="sheet-line__conf${hasConfidence(line) ? '' : ' sheet-line__conf--none'}"></span>`;

    el.innerHTML = `
      <span class="sheet-line__grip" aria-hidden="true">${icon('grip-vertical', { size: 12 })}</span>
      <span class="sheet-line__text">${isEmpty ? EMPTY_TEXT : escapeHtml(line.text)}</span>
      ${confHtml}
    `;

    const confEl = el.querySelector('.sheet-line__conf');
    if (confEl && hasConfidence(line)) {
      confEl.style.width = `${Math.round(line.confidence * 100)}%`;
    }
  }

  /** Dispara una acción de estructura y cierra la edición local sin
   * repintar: el documento va a cambiar de forma (el renglón puede
   * desaparecer, partirse o correr de índice), así que el repintado real lo
   * hace el orquestador cuando la acción resuelve. */
  function dispatchStructureAction(action) {
    editing = false;
    handlers.runAction(action, { rowEl: el });
  }

  function doSplitAtCaret(textarea) {
    const caret = textarea.selectionStart;
    const text = textarea.value;
    const withBreak = `${text.slice(0, caret)}\n${text.slice(caret)}`;
    dispatchStructureAction({ type: 'setLineText', section: sIdx, line: lIdx, text: withBreak });
  }

  /** Persiste el texto sucio si cambió y cierra la edición; no-op si no hay
   * edición en curso (blur y Cmd/Ctrl+Enter convergen acá). */
  async function flushText() {
    if (!editing) return;
    const textarea = el.querySelector('.sheet-line__edit-input');
    const text = textarea ? textarea.value : originalText;
    editing = false;
    if (text !== originalText) {
      await handlers.persistText(sIdx, lIdx, text);
    }
    render();
  }

  function updateMergeLabel() {
    const textarea = el.querySelector('.sheet-line__edit-input');
    const mergeBtn = el.querySelector('[data-action="merge"]');
    if (!textarea || !mergeBtn) return;
    mergeBtn.textContent = textarea.selectionStart === 0 ? 'Unir arriba' : 'Unir abajo';
  }

  function wireEdit() {
    const textarea = el.querySelector('.sheet-line__edit-input');

    autogrow(textarea);
    textarea.focus();
    const pos =
      pendingCaret === null || pendingCaret === undefined ? textarea.value.length : pendingCaret;
    textarea.setSelectionRange(pos, pos);
    pendingCaret = null;
    updateMergeLabel();

    textarea.addEventListener('input', () => autogrow(textarea));
    textarea.addEventListener('blur', () => flushText());
    textarea.addEventListener('keyup', updateMergeLabel);
    textarea.addEventListener('click', updateMergeLabel);
    textarea.addEventListener('select', updateMergeLabel);
    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        editing = false;
        render();
      } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        flushText();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        doSplitAtCaret(textarea);
      } else if (
        ev.key === 'Backspace' &&
        textarea.selectionStart === 0 &&
        textarea.selectionEnd === 0 &&
        lIdx > 0
      ) {
        ev.preventDefault();
        dispatchStructureAction({ type: 'mergeLines', section: sIdx, line: lIdx - 1 });
      }
    });

    el.querySelectorAll('.sheet-line__scissor').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const pos2 = offsetAfterWord(textarea.value, Number(btn.dataset.afterWord));
        textarea.focus();
        textarea.setSelectionRange(pos2, pos2);
        updateMergeLabel();
      });
    });

    el.querySelector('[data-action="split"]').addEventListener('click', () =>
      doSplitAtCaret(textarea),
    );
    el.querySelector('[data-action="merge"]').addEventListener('click', () => {
      const caret = textarea.selectionStart;
      dispatchStructureAction(
        caret === 0
          ? { type: 'mergeLines', section: sIdx, line: lIdx - 1 }
          : { type: 'mergeLines', section: sIdx, line: lIdx },
      );
    });
    el.querySelector('[data-action="duplicate"]').addEventListener('click', () =>
      dispatchStructureAction({ type: 'duplicateLine', section: sIdx, line: lIdx }),
    );
    el.querySelector('[data-action="voc"]').addEventListener('click', () =>
      dispatchStructureAction({ type: 'toggleVocalization', section: sIdx, line: lIdx }),
    );
    el.querySelector('[data-action="delete"]').addEventListener('click', () =>
      dispatchStructureAction({ type: 'deleteLine', section: sIdx, line: lIdx }),
    );
  }

  function renderEdit() {
    const isVoc = !!line.vocalization;
    const text = line.text ?? '';
    el.className = ['sheet-line', 'sheet-line--editing', isVoc ? 'sheet-line--vocalization' : '']
      .filter(Boolean)
      .join(' ');

    el.innerHTML = `
      <span class="sheet-line__grip" aria-hidden="true">${icon('grip-vertical', { size: 12 })}</span>
      <textarea class="sheet-line__edit-input" rows="1" aria-label="Texto del renglón">${escapeHtml(text)}</textarea>
      ${scissorsHtml(text, afterWords)}
      <div class="sheet-line__toolbar">
        <button type="button" class="sheet-line__action" data-action="split">Partir</button>
        <button type="button" class="sheet-line__action" data-action="merge"></button>
        <button type="button" class="sheet-line__action" data-action="duplicate">Duplicar</button>
        <button type="button" class="sheet-line__action${isVoc ? ' is-active' : ''}" data-action="voc">Voc.</button>
        <button type="button" class="sheet-line__action" data-action="delete">Borrar</button>
      </div>
    `;
    wireEdit();
  }

  function render() {
    if (editing) renderEdit();
    else renderReposo();
  }

  function openEdit({ caret = null } = {}) {
    if (handlers.isBusy() || editing) return;
    editing = true;
    originalText = line.text ?? '';
    pendingCaret = caret;
    render();
  }

  render();

  el.addEventListener('click', (ev) => {
    if (editing) return;
    if (ev.target.closest('.sheet-line__text')) openEdit({ caret: null });
  });

  el.update = function update(next = {}) {
    if ('line' in next) line = next.line;
    if ('afterWords' in next) afterWords = next.afterWords;
    if ('suggestion' in next) suggestion = next.suggestion;
    if ('isDudoso' in next) isDudoso = next.isDudoso;
    if ('canMoveUp' in next) canMoveUp = next.canMoveUp;
    if ('canMoveDown' in next) canMoveDown = next.canMoveDown;
    // No pisar una edición en curso: el texto sucio vive en el textarea del
    // closure hasta que flushText() lo persista.
    if (!editing) render();
  };

  el.openEdit = openEdit;
  el.flushText = flushText;

  return el;
}
