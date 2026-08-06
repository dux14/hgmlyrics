/**
 * SheetSection.js — una sección completa de la hoja viva de revisión de
 * letra (S3a, Task 5). Compone `SheetLine` y `SheetSeparator`: encabezado
 * (chip de tipo, nombre opcional, menú de acciones de sección) más el
 * cuerpo, renglones intercalados con separadores.
 *
 * Una sección sin renglones se pinta igual, con su encabezado completo — el
 * cuerpo ofrece insertar el primer renglón en vez de esconderse (spec:
 * «instrumental es contenido, no vacío», ver `docs/plans/...notes.md`).
 *
 * S3b-ii suma `timingByLine` (mapa lIdx → {startMs, interpolated}, para que
 * cada `SheetLine` pinte su barra de confianza como estimada) y `readOnly`
 * (la confirmación previa al approve, ahora la misma hoja sin controles de
 * edición) más `setLineActive`/`setBandActive`, que el orquestador usa para
 * mover el resaltado del renglón/banda que suena sin repintar nada.
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
 *   textByLine: Map, dudosoThreshold: number, timingByLine?: Map,
 *   readOnly?: boolean, handlers: object}} opts
 * @returns {HTMLElement}
 */
export function SheetSection(opts) {
  const { handlers } = opts;
  let { section, sIdx, isLast, byLine, textByLine, dudosoThreshold } = opts;
  let timingByLine = opts.timingByLine ?? new Map();
  let readOnly = opts.readOnly ?? false;

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

  // Referencias vivas del menú de sección — al alcance de openMenu/closeMenu
  // para poder limpiar los listeners de documento aunque renderHeader() haya
  // reconstruido el encabezado desde el último open().
  let menuEl = null;
  let menuToggleEl = null;
  let menuListEl = null;
  let menuDocHandlers = null;

  function closeMenu() {
    menuEl?.classList.remove('is-open');
    if (menuDocHandlers) {
      document.removeEventListener('click', menuDocHandlers.onClick, true);
      document.removeEventListener('keydown', menuDocHandlers.onKeydown, true);
      window.removeEventListener('scroll', menuDocHandlers.onReflow, true);
      window.removeEventListener('resize', menuDocHandlers.onReflow);
      menuDocHandlers = null;
    }
  }

  /** La lista es `position: fixed` (ver pipeline.css): la sección tiene
   * `overflow: hidden` y recortaba el menú a la altura del encabezado. Acá se
   * ancla al toggle contra el viewport, abriendo hacia arriba cuando abajo no
   * cabe y acotando la altura al espacio libre — el resto se ve con scroll. */
  function positionMenu() {
    if (!menuListEl || !menuToggleEl || !menuEl?.classList.contains('is-open')) return;
    const MARGIN = 8;
    const GAP = 4;
    const anchor = menuToggleEl.getBoundingClientRect();
    // Sin tope primero: se mide la altura natural para elegir el lado.
    menuListEl.style.maxHeight = '';
    const natural = menuListEl.offsetHeight;
    const width = menuListEl.offsetWidth;
    const below = window.innerHeight - anchor.bottom - GAP - MARGIN;
    const above = anchor.top - GAP - MARGIN;
    const openUp = natural > below && above > below;
    // Piso chico a propósito: con un piso alto el menú se pasaba del espacio
    // libre y terminaba tapando el propio toggle.
    const maxHeight = Math.max(48, openUp ? above : below);
    menuListEl.style.maxHeight = `${maxHeight}px`;
    const height = Math.min(natural, maxHeight);
    const top = openUp ? anchor.top - GAP - height : anchor.bottom + GAP;
    const left = Math.min(
      Math.max(MARGIN, anchor.right - width),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );
    menuListEl.style.top = `${Math.max(MARGIN, top)}px`;
    menuListEl.style.left = `${left}px`;
  }

  /** Click afuera o Escape cierran el menú — sin esto quedaba abierto hasta
   * el próximo toque en el toggle. Los listeners son de documento (fase de
   * captura, para adelantarse a cualquier stopPropagation) y se retiran al
   * cerrar: `update()` reconstruye el encabezado entero con `innerHTML`, así
   * que dejarlos colgados apuntaría a nodos ya desprendidos del DOM. */
  function openMenu() {
    menuEl.classList.add('is-open');
    positionMenu();
    const onClick = (ev) => {
      if (!menuEl.contains(ev.target)) closeMenu();
    };
    const onKeydown = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeMenu();
        menuToggleEl?.focus();
      }
    };
    // El menú es fixed: si la hoja se desplaza debajo, hay que re-anclarlo al
    // toggle. Captura + passive para enterarse del scroll de cualquier
    // contenedor, no solo del documento.
    const onReflow = () => positionMenu();
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('scroll', onReflow, { capture: true, passive: true });
    window.addEventListener('resize', onReflow);
    menuDocHandlers = { onClick, onKeydown, onReflow };
  }

  function isDudosoFor(line) {
    return (
      typeof dudosoThreshold === 'number' &&
      typeof line.confidence === 'number' &&
      line.confidence < dudosoThreshold
    );
  }

  function lineProps(lIdx) {
    const key = `${sIdx}:${lIdx}`;
    const timing = timingByLine.get(lIdx);
    return {
      line: section.lines[lIdx],
      sIdx,
      lIdx,
      afterWords: byLine.get(key) || [],
      suggestion: textByLine.get(key) || null,
      isDudoso: isDudosoFor(section.lines[lIdx]),
      canMoveUp: lIdx > 0,
      canMoveDown: lIdx < section.lines.length - 1,
      interpolated: Boolean(timing?.interpolated),
      readOnly,
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
   * renglones, no se superponen. En lectura no se ofrece insertar (sin nada
   * que editar), la banda instrumental se pinta igual. */
  function syncBody() {
    const lines = section.lines;

    if (lines.length === 0) {
      lineNodes.forEach((node) => node.remove());
      sepNodes.forEach((node) => node.remove());
      lineNodes = [];
      sepNodes = [];

      // El tipo manda, no el contenido: una sección tipada 'instrumental'
      // sin renglones pinta la banda; cualquier otro tipo sin renglones
      // ofrece insertar el primero (salvo en lectura). Nunca coexisten.
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
        if (readOnly) {
          if (emptyEl) {
            emptyEl.remove();
            emptyEl = null;
          }
        } else if (!emptyEl) {
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
      // Sin separadores en lectura: no hay nada que insertar ni cortar.
      if (!readOnly && i < lines.length - 1 && !sepNodes[i]) {
        const sep = SheetSeparator({ sIdx, afterLine: i, handlers });
        sepNodes[i] = sep;
        bodyEl.appendChild(sep);
      }
    }
    while (lineNodes.length > lines.length) {
      lineNodes.pop().remove();
    }
    if (readOnly) {
      sepNodes.forEach((sep) => sep?.remove());
      sepNodes = [];
    } else {
      while (sepNodes.length > lines.length - 1) {
        const sep = sepNodes.pop();
        if (sep) sep.remove();
      }
    }
  }

  function renderHeader() {
    // Limpia cualquier menú abierto del encabezado anterior antes de
    // reemplazarlo por completo — si no, los listeners de documento de
    // openMenu() quedan referenciando nodos ya desprendidos.
    closeMenu();

    const type = normalizeSectionType(section.type);

    if (readOnly) {
      headerEl.innerHTML = `
        <span class="sheet-section__type-badge">${escapeHtml(SECTION_TYPE_LABELS[type] || type)}</span>
        ${section.label ? `<span class="sheet-section__name-text">${escapeHtml(section.label)}</span>` : ''}
      `;
      menuEl = null;
      menuToggleEl = null;
      menuListEl = null;
      return;
    }

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
    menuToggleEl = headerEl.querySelector('.sheet-section__menu-toggle');
    menuEl = headerEl.querySelector('.sheet-section__menu');
    menuListEl = headerEl.querySelector('.sheet-section__menu-list');

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

    menuToggleEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (menuEl.classList.contains('is-open')) closeMenu();
      else openMenu();
    });

    headerEl.querySelector('[data-action="rename"]').addEventListener('click', () => {
      closeMenu();
      nameInput.focus();
    });
    headerEl.querySelector('[data-action="duplicate"]').addEventListener('click', () => {
      closeMenu();
      handlers
        .runAction({ type: 'duplicateSection', section: sIdx }, { rowEl: el })
        .catch(() => {});
    });
    const mergeBtn = headerEl.querySelector('[data-action="merge"]');
    if (mergeBtn) {
      mergeBtn.addEventListener('click', () => {
        closeMenu();
        handlers.runAction({ type: 'mergeSections', section: sIdx }, { rowEl: el }).catch(() => {});
      });
    }
    headerEl.querySelector('[data-action="delete"]').addEventListener('click', () => {
      closeMenu();
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
    if ('timingByLine' in next) timingByLine = next.timingByLine ?? new Map();
    if ('readOnly' in next) readOnly = Boolean(next.readOnly);
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

  /** El orquestador mueve acá el resaltado del renglón que suena — conmuta
   * una clase y nada más, sin pasar por update()/render(). */
  el.setLineActive = function setLineActive(lIdx, on) {
    lineNodes[lIdx]?.setActive(on);
  };

  /** Igual que setLineActive pero para la banda instrumental (lIdx null en
   * el timeline: el segmento suena aunque no haya renglón). */
  el.setBandActive = function setBandActive(on) {
    instrumentalEl?.setActive(on);
  };

  return el;
}
