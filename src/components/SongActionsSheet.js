/**
 * SongActionsSheet.js — Bottom-sheet "Más" con las acciones de gestión de la
 * vista de canción (Task 18, decisión 6 opción A del brainstorm).
 *
 * Antes vivían sueltas en la toolbar (Editar canción / Procesamiento /
 * Estudio / Partitura), dos de ellas con "pop-in" async tras `getSongStudio`.
 * Con este sheet la toolbar queda estable (solo acciones de CANTAR + botón
 * "más") y la resolución condicional de qué items mostrar ocurre acá, cuando
 * el llamador arma la lista `items` con lo que ya resolvió.
 *
 * Patrón SINGLETON calcado de OptionsSheet.js (misma apertura/cierre, mismo
 * trap de foco, mismo backdrop) — no reinventa nada, solo pinta una lista de
 * acciones en vez de controles.
 */

import { escapeHtml } from '../lib/escape.js';
import { icon } from '../lib/icons.js';

const CLOSE_FALLBACK_MS = 200;

/** @type {{ dim: HTMLElement, sheet: HTMLElement, close: Function, update: Function } | null} */
let openEls = null;

/**
 * Abre el bottom-sheet de acciones de la canción sobre el body.
 * Idempotente: si ya hay una hoja abierta, refresca su contenido con los
 * items nuevos (mismo patrón que openOptionsSheet) y devuelve el controlador
 * vivo en vez de montar una segunda instancia.
 *
 * @param {{
 *   items: Array<{ id: string, icon: string, label: string, subLabel?: string, onClick?: () => void }>,
 *   onClose?: () => void,
 * }} opts
 * @returns {{ close: () => void, sheet: HTMLElement }}
 */
export function openSongActionsSheet(opts) {
  if (openEls) {
    openEls.update(opts);
    return { close: openEls.close, sheet: openEls.sheet };
  }
  // Reapertura rápida: retira cualquier hoja anterior aún saliendo (animación).
  document
    .querySelectorAll('.sasheet--closing, .sasheet-dim--closing')
    .forEach((el) => el.remove());

  // Elemento que disparó la apertura: se restaura el foco ahí al cerrar.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const dim = document.createElement('div');
  dim.className = 'sasheet-dim';

  const sheet = document.createElement('div');
  sheet.className = 'sasheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Más acciones');
  sheet.setAttribute('tabindex', '-1');

  let current = opts;
  function renderContent(o) {
    current = o;
    sheet.innerHTML = buildSheetHtml(o);
    bindSheetHandlers(sheet, o);
  }
  renderContent(opts);

  let closed = false;
  function unmount() {
    dim.remove();
    sheet.remove();
    document.removeEventListener('keydown', onKeydown);
    if (opener?.isConnected) opener.focus();
  }

  function close() {
    if (closed) return;
    closed = true;
    // Se libera de inmediato para permitir reapertura durante la animación de salida.
    openEls = null;
    document.removeEventListener('keydown', onKeydown);
    current.onClose?.();

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      unmount();
      return;
    }

    dim.classList.add('sasheet-dim--closing');
    sheet.classList.add('sasheet--closing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unmount();
    };
    sheet.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, CLOSE_FALLBACK_MS);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const focusables = sheet.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Trap manual: aria-modal no atrapa el foco por si solo (mismo hazard
      // que OptionsSheet); ciclo cerrado dentro del dialog.
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!sheet.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKeydown);

  dim.addEventListener('click', close);

  document.body.append(dim, sheet);
  sheet.focus();

  openEls = { dim, sheet, close, update: renderContent };
  return { close, sheet };
}

/**
 * Arma el HTML interno del sheet (grab handle + lista de items) a partir de
 * opts. Función pura: no toca el DOM, solo devuelve el string del template.
 */
function buildSheetHtml(opts) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  const itemsHtml = items
    .map(
      (it) => `
    <button class="sasheet__item" type="button" data-sasheet-item="${escapeHtml(it.id)}">
      <span class="sasheet__item-icon">${icon(it.icon, { size: 18 })}</span>
      <span class="sasheet__item-text">
        <span class="sasheet__item-label">${escapeHtml(it.label)}</span>
        ${it.subLabel ? `<span class="sasheet__item-sub">${escapeHtml(it.subLabel)}</span>` : ''}
      </span>
    </button>`,
    )
    .join('');

  return `
    <div class="sasheet__grab"></div>
    <div class="sasheet__list">${itemsHtml}</div>
  `;
}

/**
 * Ata el click de cada item a su `onClick` y cierra el sheet — se llama tras
 * cada `sheet.innerHTML = buildSheetHtml(opts)`, así que siempre ata sobre
 * DOM nuevo (sin listeners duplicados de renders previos).
 */
function bindSheetHandlers(sheet, opts) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  sheet.querySelectorAll('[data-sasheet-item]').forEach((btn) => {
    const item = items.find((it) => it.id === btn.dataset.sasheetItem);
    btn.addEventListener('click', () => {
      item?.onClick?.();
      closeSongActionsSheet();
    });
  });
}

/**
 * Cierra la hoja de acciones si está abierta (dispara la salida animada).
 * No-op si no hay hoja abierta.
 */
export function closeSongActionsSheet() {
  openEls?.close();
}

/**
 * @returns {boolean} true si la hoja de acciones está abierta.
 */
export function isSongActionsSheetOpen() {
  return openEls !== null;
}
