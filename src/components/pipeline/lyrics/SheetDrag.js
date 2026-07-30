/**
 * SheetDrag.js — el gesto de arrastre de renglones de la hoja viva.
 *
 * UNA instancia por hoja, no una por renglón: el estado del gesto es global
 * (hay como máximo un arrastre vivo) y cuarenta renglones serían cuarenta
 * juegos de listeners. El grip se descubre por delegación desde la raíz, así
 * que los repintados de `syncSections` no exigen re-cablear nada.
 *
 * Se mide UNA vez, al arrancar, en coordenadas de DOCUMENTO: el autoscroll
 * mueve el viewport, no el documento, así que `clientY + scrollY` sigue siendo
 * válido sin re-medir en cada pointermove.
 *
 * La geometría vive en `dragTarget.js` y la conversión de índices en
 * `movePayload.js`; este módulo solo orquesta eventos y pinta.
 */
import { dropTargetAt } from './dragTarget.js';
import { moveLinePayload } from './movePayload.js';

/** Rects de todas las secciones y renglones montados, en coordenadas de
 * documento. Es el default de `opts.measure`; los tests lo reemplazan porque
 * jsdom devuelve ceros en getBoundingClientRect. */
function measureSheet(root) {
  const scrollY = window.scrollY;
  return [...root.querySelectorAll('.sheet-section')].map((sectionEl, sIdx) => {
    const box = sectionEl.getBoundingClientRect();
    const band = sectionEl.querySelector('.sheet-instrumental');
    const lineEls = [...sectionEl.querySelectorAll('.sheet-line')];
    return {
      sIdx,
      isBand: Boolean(band),
      top: box.top + scrollY,
      bottom: box.bottom + scrollY,
      lines: lineEls.map((lineEl, lIdx) => {
        const r = lineEl.getBoundingClientRect();
        return { lIdx, mid: r.top + r.height / 2 + scrollY };
      }),
    };
  });
}

/** Índices del renglón dentro de la hoja, leídos de la posición en el DOM —
 * no de dataset: los repintados por índice ya mantienen el orden 1:1. */
function locate(root, lineEl) {
  const sectionEl = lineEl.closest('.sheet-section');
  const sIdx = [...root.querySelectorAll('.sheet-section')].indexOf(sectionEl);
  const lIdx = [...sectionEl.querySelectorAll('.sheet-line')].indexOf(lineEl);
  return { sIdx, lIdx };
}

const EDGE_PX = 64;
const MAX_SPEED_PX = 14;

/** Velocidad de autoscroll según cuánto penetró el puntero en la franja del
 * borde: 0 fuera de la franja, MAX_SPEED_PX pegado al canto. */
function edgeSpeed(clientY, box) {
  if (clientY < box.top + EDGE_PX) {
    const depth = box.top + EDGE_PX - clientY;
    return -Math.min(depth / EDGE_PX, 1) * MAX_SPEED_PX;
  }
  if (clientY > box.bottom - EDGE_PX) {
    const depth = clientY - (box.bottom - EDGE_PX);
    return Math.min(depth / EDGE_PX, 1) * MAX_SPEED_PX;
  }
  return 0;
}

/**
 * @param {{root: HTMLElement, handlers: {isBusy: Function, moveLine: Function},
 *   measure?: Function, scroller?: HTMLElement|null}} opts
 * @returns {{destroy: Function}}
 */
export function SheetDrag(opts) {
  const { root, handlers } = opts;
  const measure = opts.measure ?? (() => measureSheet(root));

  let drag = null;
  let dropLine = null;
  const scroller = opts.scroller ?? document.scrollingElement ?? document.body;
  let autoRaf = null;
  let autoSpeed = 0;

  function stopAutoScroll() {
    if (autoRaf !== null) cancelAnimationFrame(autoRaf);
    autoRaf = null;
    autoSpeed = 0;
  }

  function tickAutoScroll() {
    autoRaf = null;
    if (!drag || autoSpeed === 0) return;
    scroller.scrollTop += autoSpeed;
    autoRaf = requestAnimationFrame(tickAutoScroll);
  }

  function clearDropIndicator() {
    dropLine?.remove();
    dropLine = null;
    root
      .querySelectorAll('.sheet-instrumental--drop')
      .forEach((el) => el.classList.remove('sheet-instrumental--drop'));
  }

  function showDropIndicator(target) {
    clearDropIndicator();
    if (!target) return;
    const sectionEl = root.querySelectorAll('.sheet-section')[target.toSection];
    if (!sectionEl) return;
    const band = sectionEl.querySelector('.sheet-instrumental');
    if (band) {
      band.classList.add('sheet-instrumental--drop');
      return;
    }
    dropLine = document.createElement('div');
    dropLine.className = 'sheet-drop-line';
    const lineEls = [...sectionEl.querySelectorAll('.sheet-line')];
    const body = sectionEl.querySelector('.sheet-section__body') ?? sectionEl;
    const at = lineEls[target.toLine];
    if (at) body.insertBefore(dropLine, at);
    else body.appendChild(dropLine);
  }

  function end({ commit }) {
    if (!drag) return;
    const { lineEl, ghost, from, target, pointerId, grip } = drag;
    drag = null;

    ghost.remove();
    lineEl.classList.remove('sheet-line--dragging');
    clearDropIndicator();
    stopAutoScroll();
    try {
      grip.releasePointerCapture?.(pointerId);
    } catch {
      // El puntero ya se liberó solo (pointercancel): no es un error.
    }

    // El lock se libera ANTES de despachar: `moveLine` entra a `runAction`,
    // que se autobloquea si `isBusy()` sigue viendo el arrastre como vivo. Si
    // el orden se invierte, el drop se descarta en silencio.
    handlers.setDragging?.(false);

    if (!commit) return;
    const payload = moveLinePayload(target ? { ...from, ...target } : null);
    if (payload) Promise.resolve(handlers.moveLine(payload)).catch(() => {});
  }

  function onPointerDown(ev) {
    const grip = ev.target.closest?.('.sheet-line__grip');
    if (!grip || !root.contains(grip)) return;
    // Solo el botón principal arrastra: un clic derecho sobre el grip tiene que
    // seguir abriendo el menú contextual del navegador.
    if (typeof ev.button === 'number' && ev.button !== 0) return;
    if (drag || handlers.isBusy()) return;

    const lineEl = grip.closest('.sheet-line');
    if (!lineEl) return;
    ev.preventDefault();

    // La edición se cierra ANTES de empezar a mover: el textarea tiene su
    // propio listener de Escape y, con el foco puesto, consumiría la tecla que
    // acá cancela el arrastre. El texto sucio no se pierde — `runAction` llama
    // `flushAllLines()` antes de cualquier acción que no sea setLineText.
    lineEl.flushText?.();

    const { sIdx, lIdx } = locate(root, lineEl);
    const box = lineEl.getBoundingClientRect();
    const ghost = lineEl.cloneNode(true);
    ghost.classList.add('sheet-line--ghost');
    ghost
      .querySelectorAll('[tabindex], button, textarea')
      .forEach((n) => n.setAttribute('tabindex', '-1'));
    ghost.style.width = `${box.width}px`;
    ghost.style.top = `${box.top}px`;
    ghost.style.left = `${box.left}px`;
    document.body.appendChild(ghost);
    lineEl.classList.add('sheet-line--dragging');

    grip.setPointerCapture?.(ev.pointerId);
    drag = {
      grip,
      lineEl,
      ghost,
      pointerId: ev.pointerId,
      rects: measure(),
      from: { fromSection: sIdx, fromLine: lIdx },
      target: null,
      grabDy: ev.clientY - box.top,
    };
    handlers.setDragging?.(true);
  }

  function onPointerMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    ev.preventDefault();
    drag.ghost.style.top = `${ev.clientY - drag.grabDy}px`;
    drag.target = dropTargetAt(drag.rects, ev.clientY + window.scrollY);
    showDropIndicator(drag.target);
    autoSpeed = edgeSpeed(ev.clientY, scroller.getBoundingClientRect());
    if (autoSpeed !== 0 && autoRaf === null) autoRaf = requestAnimationFrame(tickAutoScroll);
    if (autoSpeed === 0) stopAutoScroll();
  }

  function onPointerUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    end({ commit: true });
  }

  function onPointerCancel(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    end({ commit: false });
  }

  function onKeyDown(ev) {
    if (drag && ev.key === 'Escape') {
      ev.preventDefault();
      end({ commit: false });
    }
  }

  root.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('keydown', onKeyDown);

  return {
    destroy() {
      end({ commit: false });
      root.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
