/**
 * scrollChrome.js — decisión pura show/hide del header al desplazarse.
 *
 * Patrón estándar: scroll hacia abajo con intent (más de un par de px, no el
 * primer pixel) oculta el header; cualquier scroll hacia arriba lo muestra;
 * en el tope (scrollY 0) siempre visible. Extraída como función pura para
 * poder testear la lógica sin DOM/rAF real — el motor de abajo solo aporta
 * el scrollY leído en cada frame.
 */

/** Umbral mínimo de scroll hacia abajo antes de ocultar (px). */
export const HIDE_THRESHOLD_PX = 8;

/**
 * @param {object} params
 * @param {number} params.scrollY - scrollY actual
 * @param {number} params.lastScrollY - scrollY leído en el cálculo anterior
 * @param {boolean} params.visible - visibilidad actual del header
 * @returns {boolean} nueva visibilidad
 */
export function computeHeaderVisibility({ scrollY, lastScrollY, visible }) {
  if (scrollY <= 0) return true;

  const delta = scrollY - lastScrollY;
  if (delta > HIDE_THRESHOLD_PX) return false;
  if (delta < 0) return true;
  return visible;
}

// --- Motor único de auto-hide para header + bottom-nav, por ruta -----------
//
// Se engancha UNA vez desde main.js sobre el shell (header + nav) y cada ruta
// declara su propia política vía `setChromeAutoHide`. Reusa
// `computeHeaderVisibility` para la decisión show/hide.

const NAV_HIDE_CLASS = 'bottom-nav--auto-hide';
const HEADER_HIDE_CLASS = 'header--auto-hide';

let chrome = null; // { headerEl, navEl } — singleton del shell
let config = { header: false, nav: false };
let lastScrollY = 0;
let visible = true;
let scheduled = false;

function applyVisibility(nextVisible) {
  visible = nextVisible;
  const hidden = !visible;
  if (config.header && chrome.headerEl) {
    chrome.headerEl.classList.toggle(HEADER_HIDE_CLASS, hidden);
  }
  if (config.nav && chrome.navEl) {
    chrome.navEl.classList.toggle(NAV_HIDE_CLASS, hidden);
    // Offset para lo anclado encima del nav (section-player): 0 al ocultarse.
    if (hidden) document.documentElement.style.setProperty('--bnav-offset', '0px');
    else document.documentElement.style.removeProperty('--bnav-offset');
  }
  if (config.header) {
    if (hidden) document.documentElement.style.setProperty('--header-offset', '0px');
    else document.documentElement.style.removeProperty('--header-offset');
  }
}

function onFrame() {
  scheduled = false;
  const scrollY = window.scrollY;
  const next = computeHeaderVisibility({ scrollY, lastScrollY, visible });
  lastScrollY = scrollY;
  if (next !== visible) applyVisibility(next);
}

function onScroll() {
  if (scheduled || (!config.header && !config.nav)) return;
  scheduled = true;
  requestAnimationFrame(onFrame);
}

/** Se llama UNA vez desde main.js con los elementos del shell. */
export function initChromeAutoHide(els) {
  chrome = els;
  window.addEventListener('scroll', onScroll, { passive: true });
}

/** Se llama en cada cambio de ruta con la política de esa pantalla. */
export function setChromeAutoHide(next) {
  // Antes de cambiar de política, restaurar todo visible (cada ruta arranca limpia).
  if (chrome) {
    const prev = config;
    config = { header: true, nav: true };
    applyVisibility(true);
    config = prev;
  }
  config = { header: !!next.header, nav: !!next.nav };
  lastScrollY = window.scrollY;
  visible = true;
}
