/**
 * SheetSection.js — una sección completa de la hoja viva de revisión de
 * letra (S3a, Task 5). Compone `SheetLine` y `SheetSeparator`: encabezado
 * (chip de tipo, nombre opcional, menú de acciones de sección) más el
 * cuerpo, renglones intercalados con separadores.
 *
 * Una sección sin renglones se pinta igual, con su encabezado completo — el
 * cuerpo ofrece insertar el primer renglón en vez de esconderse (spec:
 * «instrumental es contenido, no vacío», ver `docs/plans/...notes.md`).
 */
import { icon } from '../../../lib/icons.js';
import { escapeHtml } from '../../../lib/escape.js';
import { SECTION_TYPE_LABELS, normalizeSectionType } from '../../../lib/sectionTypes.js';
import { SheetLine } from './SheetLine.js';
import { SheetSeparator } from './SheetSeparator.js';
import { InstrumentalBand } from './InstrumentalBand.js';

function typeOptionsHtml(currentType) {
  return Object.entries(SECTION_TYPE_LABELS)
    .map(
      ([slug, label]) =>
        `<option value="${slug}"${slug === currentType ? ' selected' : ''}>${escapeHtml(label)}</option>`,
    )
    .join('');
}

/**
 * @param {{section: object, sIdx: number, isLast: boolean, byLine: Map,
 *   textByLine: Map, dudosoThreshold: number, handlers: object}} opts
 * @returns {HTMLElement}
 */
export function SheetSection(opts) {
  const { handlers } = opts;
  let { section, sIdx, isLast, byLine, textByLine, dudosoThreshold } = opts;

  const el = document.createElement('div');
  el.className = 'sheet-section';
  el.innerHTML = `
    <div class="sheet-section__header"></div>
    <div class="sheet-section__body"></div>
  `;
  const headerEl = el.querySelector('.sheet-section__header');
  const bodyEl = el.querySelector('.sheet-section__body');

  // Nodos vivos del cuerpo, alineados 1:1 con section.lines — reusados en
  // update() para no recrear los renglones que no cambiaron de índice.
  let lineNodes = [];
  let sepNodes = [];
  let emptyEl = null;
  let instrumentalEl = null;

  function isDudosoFor(line) {
    return (
      typeof dudosoThreshold === 'number' &&
      typeof line.confidence === 'number' &&
      line.confidence < dudosoThreshold
    );
  }

  function lineProps(lIdx) {
    const key = `${sIdx}:${lIdx}`;
    return {
      line: section.lines[lIdx],
      sIdx,
      lIdx,
      afterWords: byLine.get(key) || [],
      suggestion: textByLine.get(key) || null,
      isDudoso: isDudosoFor(section.lines[lIdx]),
      canMoveUp: lIdx > 0,
      canMoveDown: lIdx < section.lines.length - 1,
      handlers,
    };
  }

  function renderEmptyInsert() {
    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'sheet-section__insert-first';
    insert.innerHTML = `${icon('plus', { size: 14 })}<span>Insertar renglón</span>`;
    insert.addEventListener('click', () => {
      if (handlers.isBusy()) return;
      handlers.runAction({ type: 'insertLine', section: sIdx, at: 0 }, { rowEl: insert });
    });
    return insert;
  }

  /** Pinta el cuerpo: reusa nodos existentes por índice, agrega los que
   * faltan y descarta los sobrantes (encoge). La banda instrumental y el
   * "insertar primer renglón" son estados excluyentes con la lista de
   * renglones, no se superponen. */
  function syncBody() {
    const lines = section.lines;

    if (lines.length === 0) {
      lineNodes.forEach((node) => node.remove());
      sepNodes.forEach((node) => node.remove());
      lineNodes = [];
      sepNodes = [];

      // El tipo manda, no el contenido: una sección tipada 'instrumental'
      // sin renglones pinta la banda; cualquier otro tipo sin renglones
      // ofrece insertar el primero. Nunca coexisten.
      const isInstrumental = normalizeSectionType(section.type) === 'instrumental';
      if (isInstrumental) {
        if (emptyEl) {
          emptyEl.remove();
          emptyEl = null;
        }
        if (instrumentalEl) {
          instrumentalEl.update(section);
        } else {
          instrumentalEl = InstrumentalBand({ section });
          bodyEl.appendChild(instrumentalEl);
        }
      } else {
        if (instrumentalEl) {
          instrumentalEl.remove();
          instrumentalEl = null;
        }
        if (!emptyEl) {
          emptyEl = renderEmptyInsert();
          bodyEl.appendChild(emptyEl);
        }
      }
      return;
    }

    if (emptyEl) {
      emptyEl.remove();
      emptyEl = null;
    }
    if (instrumentalEl) {
      instrumentalEl.remove();
      instrumentalEl = null;
    }

    for (let i = 0; i < lines.length; i++) {
      if (lineNodes[i]) {
        lineNodes[i].update(lineProps(i));
      } else {
        const node = SheetLine(lineProps(i));
        lineNodes[i] = node;
        bodyEl.appendChild(node);
      }
      if (i < lines.length - 1 && !sepNodes[i]) {
        const sep = SheetSeparator({ sIdx, afterLine: i, handlers });
        sepNodes[i] = sep;
        bodyEl.appendChild(sep);
      }
    }
    while (lineNodes.length > lines.length) {
      lineNodes.pop().remove();
    }
    while (sepNodes.length > lines.length - 1) {
      const sep = sepNodes.pop();
      if (sep) sep.remove();
    }
  }

  function renderHeader() {
    const type = normalizeSectionType(section.type);
    headerEl.innerHTML = `
      <select class="sheet-section__type" aria-label="Tipo de sección">
        ${typeOptionsHtml(type)}
      </select>
      <input type="text" class="sheet-section__name" placeholder="Nombre opcional" aria-label="Nombre de la sección" value="${escapeHtml(section.label ?? '')}" />
      <div class="sheet-section__menu">
        <button type="button" class="sheet-section__menu-toggle" aria-label="Más acciones de la sección">${icon('ellipsis-vertical', { size: 14 })}</button>
        <div class="sheet-section__menu-list">
          <button type="button" class="sheet-section__menu-item" data-action="rename">Renombrar</button>
          <button type="button" class="sheet-section__menu-item" data-action="duplicate">Duplicar sección</button>
          ${isLast ? '' : `<button type="button" class="sheet-section__menu-item" data-action="merge">Unir con la siguiente</button>`}
          <button type="button" class="sheet-section__menu-item" data-action="delete">Borrar sección</button>
        </div>
      </div>
    `;

    const select = headerEl.querySelector('.sheet-section__type');
    const nameInput = headerEl.querySelector('.sheet-section__name');
    const menuToggle = headerEl.querySelector('.sheet-section__menu-toggle');
    const menu = headerEl.querySelector('.sheet-section__menu');

    select.addEventListener('change', () => {
      handlers
        .runAction(
          { type: 'setSectionType', section: sIdx, sectionType: select.value },
          { rowEl: el },
        )
        .catch(() => {});
    });

    nameInput.addEventListener('blur', () => {
      const trimmed = nameInput.value.trim();
      handlers
        .runAction(
          { type: 'renameSection', section: sIdx, label: trimmed === '' ? null : trimmed },
          { rowEl: el },
        )
        .catch(() => {});
    });

    menuToggle.addEventListener('click', () => {
      menu.classList.toggle('is-open');
    });

    headerEl.querySelector('[data-action="rename"]').addEventListener('click', () => {
      menu.classList.remove('is-open');
      nameInput.focus();
    });
    headerEl.querySelector('[data-action="duplicate"]').addEventListener('click', () => {
      menu.classList.remove('is-open');
      handlers
        .runAction({ type: 'duplicateSection', section: sIdx }, { rowEl: el })
        .catch(() => {});
    });
    const mergeBtn = headerEl.querySelector('[data-action="merge"]');
    if (mergeBtn) {
      mergeBtn.addEventListener('click', () => {
        menu.classList.remove('is-open');
        handlers.runAction({ type: 'mergeSections', section: sIdx }, { rowEl: el }).catch(() => {});
      });
    }
    headerEl.querySelector('[data-action="delete"]').addEventListener('click', () => {
      menu.classList.remove('is-open');
      handlers.runAction({ type: 'deleteSection', section: sIdx }, { rowEl: el }).catch(() => {});
    });
  }

  renderHeader();
  syncBody();

  el.update = function update(next = {}) {
    if ('section' in next) section = next.section;
    if ('sIdx' in next) sIdx = next.sIdx;
    if ('isLast' in next) isLast = next.isLast;
    if ('byLine' in next) byLine = next.byLine;
    if ('textByLine' in next) textByLine = next.textByLine;
    if ('dudosoThreshold' in next) dudosoThreshold = next.dudosoThreshold;
    // No pisar el encabezado si tiene el foco adentro: el <select> de tipo
    // dispara runAction sin perder el foco y el <input> de nombre puede
    // tener texto sin blur todavía — mismo criterio que SheetLine con su
    // textarea de edición. El tipo/isLast pueden quedar un instante
    // atrasados; se resuelven en el próximo update() sin foco.
    if (!headerEl.contains(document.activeElement)) renderHeader();
    syncBody();
  };

  el.focusLine = function focusLine(lIdx, { caret = null } = {}) {
    lineNodes[lIdx]?.openEdit({ caret });
  };

  return el;
}
