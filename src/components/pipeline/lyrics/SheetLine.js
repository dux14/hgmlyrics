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

/** Bloque de propuesta de texto (semilla) — solo se pinta en edición, igual
 * que las tijeras, y solo si el texto propuesto difiere del actual: si
 * coinciden no hay nada que ofrecer. Aceptarla nunca pisa texto sin que el
 * usuario lo pida: es un botón, no un reemplazo automático. */
function suggestionHtml(suggestion, currentText) {
  if (!suggestion || !suggestion.text || suggestion.text === currentText) return '';
  return `
    <div class="sheet-line__suggest">
      <span class="sheet-line__suggest-text">${escapeHtml(suggestion.text)}</span>
      <button type="button" class="sheet-line__suggest-accept">Usar este texto</button>
    </div>`;
}

/** Autogrow del textarea de edición — mismo criterio que autogrow() del
 * panel de revisión viejo. */
function autogrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * @param {{line: object, sIdx: number, lIdx: number, afterWords?: number[],
 *   suggestion?: object|null, isDudoso?: boolean, canMoveUp?: boolean,
 *   canMoveDown?: boolean, interpolated?: boolean, readOnly?: boolean,
 *   handlers: object}} opts
 *   `readOnly` (S3b-ii, confirmación previa al approve): sin barra de
 *   edición, un toque en el texto salta el audio ahí en vez de abrir el
 *   textarea — en lectura no hay edición con la que competir.
 * @returns {HTMLElement}
 */
export function SheetLine(opts) {
  const { sIdx, lIdx, handlers } = opts;
  let { line, afterWords, suggestion, isDudoso, canMoveUp, canMoveDown, interpolated, readOnly } =
    opts;

  const el = document.createElement('div');
  el.className = 'sheet-line';

  let editing = false;
  // Texto de referencia al abrir edición: flushText() solo persiste si el
  // valor del textarea difiere de este — guardar vacío está permitido a
  // propósito, no se replica el `if (!text.trim()) return;` del panel viejo.
  let originalText = null;
  // Última copia conocida del texto sucio. Vive INDEPENDIENTE de `editing`:
  // el blur y las acciones de estructura compiten por cerrar la edición
  // primero (en un navegador real el blur llega antes que el click del
  // botón), así que la suciedad del texto no puede depender de ese flag o
  // flushText() se vuelve un no-op justo cuando más importa.
  let dirtyText = null;
  // Promesa de persistText en vuelo, si hay una — un segundo flushText()
  // mientras esta corre espera la MISMA promesa en vez de disparar otra.
  let flushPromise = null;
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
      : `<span class="sheet-line__conf${hasConfidence(line) ? '' : ' sheet-line__conf--none'}${interpolated ? ' sheet-line__conf--estimated' : ''}"></span>`;
    // Tercera señal del estado vocalización (junto con la itálica atenuada
    // por CSS y la ausencia de barra de confianza): el estado ya se
    // comunica por texto/clase, la marca es puramente decorativa.
    const micHtml = isVoc
      ? `<span class="sheet-line__mic" aria-hidden="true">${icon('mic', { size: 12 })}</span>`
      : '';
    // Sin grip en lectura: no hay arrastre con el que competir y el gesto de
    // toque queda libre para saltar el audio.
    const gripHtml = readOnly
      ? ''
      : `<button type="button" class="sheet-line__grip" aria-label="Mover este renglón">${icon('grip-vertical', { size: 12 })}</button>`;

    el.innerHTML = `
      ${gripHtml}
      <span class="sheet-line__text">${isEmpty ? EMPTY_TEXT : escapeHtml(line.text)}</span>
      ${micHtml}
      ${confHtml}
    `;

    const confEl = el.querySelector('.sheet-line__conf');
    if (confEl && hasConfidence(line)) {
      confEl.style.width = `${Math.round(line.confidence * 100)}%`;
    }
  }

  /** Relee el textarea (si sigue en el DOM) y actualiza `dirtyText` — se
   * llama al cierre de cada camino de edición para que el valor sobreviva a
   * `editing` volviéndose false antes de que flushText() corra. */
  function captureDirty() {
    const textarea = el.querySelector('.sheet-line__edit-input');
    if (textarea) dirtyText = textarea.value;
  }

  /** Persiste el texto sucio si cambió. Idempotente y ajena a `editing`: se
   * puede llamar después de que la edición ya se cerró (mientras quede
   * `dirtyText` sin persistir) y una segunda llamada mientras la primera
   * sigue en vuelo espera la MISMA promesa en lugar de disparar otro PUT —
   * así el blur (que dispara primero en un navegador real) y el click de un
   * botón de estructura inmediatamente después quedan serializados en vez
   * de correr como dos peticiones en paralelo sin orden garantizado. */
  async function flushText() {
    if (flushPromise) return flushPromise;
    captureDirty();
    if (dirtyText === null || dirtyText === originalText) {
      dirtyText = null;
      return undefined;
    }
    const text = dirtyText;
    dirtyText = null;
    // Nueva base optimista: una llamada posterior a flushText() sin tipeo
    // nuevo de por medio no debe re-persistir el mismo texto.
    originalText = text;
    flushPromise = handlers
      .persistText(sIdx, lIdx, text)
      .catch(() => {
        // El reporte del error al usuario es del orquestador (Task 8); acá
        // alcanza con no dejar la promesa colgando como unhandled rejection.
      })
      .finally(() => {
        flushPromise = null;
      });
    return flushPromise;
  }

  /** Dispara una acción de estructura: primero flushea el texto sucio (para
   * no perder tipeo reciente) y solo entonces manda la acción — el
   * orquestador la serializa y bloquea, así que el orden importa. Cierra la
   * edición local sin repintar: el documento va a cambiar de forma (el
   * renglón puede desaparecer, partirse o correr de índice), el repintado
   * real lo hace el orquestador cuando la acción resuelve. */
  async function dispatchStructureAction(action) {
    editing = false;
    await flushText();
    return handlers.runAction(action, { rowEl: el }).catch(() => {});
  }

  /** Excepción a dispatchStructureAction: partir ya lleva el texto completo
   * (con el `\n` insertado) en el payload, así que no hace falta flushear el
   * borrador viejo antes — se descarta, la acción lo reemplaza. */
  function dispatchSplitAction(action) {
    editing = false;
    dirtyText = null;
    return handlers.runAction(action, { rowEl: el }).catch(() => {});
  }

  /** Adoptar la propuesta de texto: igual que Partir, ya lleva el texto
   * definitivo en el payload, así que descarta cualquier borrador sin
   * guardar en vez de flushearlo. */
  function dispatchSuggestionAction(text) {
    editing = false;
    dirtyText = null;
    return handlers
      .runAction({ type: 'editLine', section: sIdx, line: lIdx, text }, { rowEl: el })
      .catch(() => {});
  }

  function doSplitAtCaret(textarea) {
    const caret = textarea.selectionStart;
    const text = textarea.value;
    const withBreak = `${text.slice(0, caret)}\n${text.slice(caret)}`;
    dispatchSplitAction({ type: 'setLineText', section: sIdx, line: lIdx, text: withBreak });
  }

  /** `canMoveUp`/`canMoveDown` se interpretan como «existe vecino
   * arriba/abajo» — la única señal con la que este componente puede saber
   * si un destino de mergeLines existe sin arriesgar un índice fuera de
   * rango (mergeLines con line: -1 revienta el reducer del backend). */
  function mergeTargetExists(caret) {
    return caret === 0 ? canMoveUp : canMoveDown;
  }

  function updateMergeLabel() {
    const textarea = el.querySelector('.sheet-line__edit-input');
    const mergeBtn = el.querySelector('[data-action="merge"]');
    if (!textarea || !mergeBtn) return;
    const caret = textarea.selectionStart;
    mergeBtn.textContent = caret === 0 ? 'Unir arriba' : 'Unir abajo';
    mergeBtn.disabled = !mergeTargetExists(caret);
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

    // Cierra la edición y persiste lo tipeado; `flushText()` ya no depende
    // de `editing`, así que da igual si algo más (una acción de estructura)
    // ya lo puso en false — la promesa se comparte, no se duplica.
    function closeAndFlush() {
      editing = false;
      flushText()
        .then(() => render())
        .catch(() => {});
    }

    textarea.addEventListener('input', () => autogrow(textarea));
    textarea.addEventListener('blur', closeAndFlush);
    textarea.addEventListener('keyup', updateMergeLabel);
    textarea.addEventListener('click', updateMergeLabel);
    textarea.addEventListener('select', updateMergeLabel);
    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        editing = false;
        dirtyText = null;
        render();
      } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        closeAndFlush();
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
        dispatchStructureAction({ type: 'mergeLines', section: sIdx, line: lIdx - 1 }).catch(
          () => {},
        );
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
      if (!mergeTargetExists(caret)) return;
      dispatchStructureAction(
        caret === 0
          ? { type: 'mergeLines', section: sIdx, line: lIdx - 1 }
          : { type: 'mergeLines', section: sIdx, line: lIdx },
      ).catch(() => {});
    });
    el.querySelector('[data-action="duplicate"]').addEventListener('click', () =>
      dispatchStructureAction({ type: 'duplicateLine', section: sIdx, line: lIdx }).catch(() => {}),
    );
    el.querySelector('[data-action="voc"]').addEventListener('click', () =>
      dispatchStructureAction({ type: 'toggleVocalization', section: sIdx, line: lIdx }).catch(
        () => {},
      ),
    );
    el.querySelector('[data-action="move-up"]').addEventListener('click', () =>
      dispatchStructureAction({ type: 'moveLineUp', section: sIdx, line: lIdx }).catch(() => {}),
    );
    el.querySelector('[data-action="move-down"]').addEventListener('click', () =>
      dispatchStructureAction({ type: 'moveLineDown', section: sIdx, line: lIdx }).catch(() => {}),
    );
    el.querySelector('[data-action="delete"]').addEventListener('click', () =>
      dispatchStructureAction({ type: 'deleteLine', section: sIdx, line: lIdx }).catch(() => {}),
    );
    // No pasa por dispatchStructureAction: escuchar mientras se corrige es el
    // caso de uso central del gate, así que la edición se queda abierta.
    el.querySelector('[data-action="listen"]')?.addEventListener('click', () =>
      handlers.listenFrom(sIdx, lIdx),
    );

    const acceptSuggestion = el.querySelector('.sheet-line__suggest-accept');
    if (acceptSuggestion) {
      acceptSuggestion.addEventListener('click', () => dispatchSuggestionAction(suggestion.text));
    }
  }

  function renderEdit() {
    const isVoc = !!line.vocalization;
    const text = line.text ?? '';
    el.className = ['sheet-line', 'sheet-line--editing', isVoc ? 'sheet-line--vocalization' : '']
      .filter(Boolean)
      .join(' ');

    el.innerHTML = `
      <button type="button" class="sheet-line__grip" aria-label="Mover este renglón">${icon('grip-vertical', { size: 12 })}</button>
      <textarea class="sheet-line__edit-input" rows="1" aria-label="Texto del renglón">${escapeHtml(text)}</textarea>
      ${scissorsHtml(text, afterWords)}
      <div class="sheet-line__toolbar">
        <button type="button" class="sheet-line__action" data-action="split">Partir</button>
        <button type="button" class="sheet-line__action" data-action="merge"></button>
        <button type="button" class="sheet-line__action" data-action="duplicate">Duplicar</button>
        <button type="button" class="sheet-line__action${isVoc ? ' is-active' : ''}" data-action="voc">Voc.</button>
        ${typeof handlers.listenFrom === 'function' ? `<button type="button" class="sheet-line__action" data-action="listen">${icon('volume-2', { size: 14 })} Escuchar</button>` : ''}
        <button type="button" class="sheet-line__action" data-action="move-up" aria-label="Mover arriba">${icon('chevron-up', { size: 14 })}</button>
        <button type="button" class="sheet-line__action" data-action="move-down" aria-label="Mover abajo">${icon('chevron-down', { size: 14 })}</button>
        <button type="button" class="sheet-line__action" data-action="delete">Borrar</button>
      </div>
      ${suggestionHtml(suggestion, text)}
    `;
    wireEdit();
  }

  function render() {
    if (editing) renderEdit();
    else renderReposo();
  }

  function openEdit({ caret = null } = {}) {
    if (readOnly || handlers.isBusy() || editing) return;
    editing = true;
    originalText = line.text ?? '';
    dirtyText = null;
    pendingCaret = caret;
    render();
  }

  render();

  el.addEventListener('click', (ev) => {
    if (readOnly) {
      if (ev.target.closest('.sheet-line__text') && typeof handlers.listenFrom === 'function') {
        handlers.listenFrom(sIdx, lIdx);
      }
      return;
    }
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
    if ('interpolated' in next) interpolated = next.interpolated;
    if ('readOnly' in next) readOnly = next.readOnly;
    // No pisar una edición en curso: el texto sucio vive en el textarea del
    // closure hasta que flushText() lo persista.
    if (!editing) render();
  };

  el.openEdit = openEdit;
  el.flushText = flushText;
  // Conmuta una clase y nada más: el resaltado corre a 20 Hz mientras suena
  // el audio, y pasar por update()/render() repintaría el renglón 20 veces
  // por segundo.
  el.setActive = (on) => el.classList.toggle('is-sounding', on);

  return el;
}
