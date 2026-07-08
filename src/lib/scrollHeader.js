/**
 * scrollHeader.js — decisión pura show/hide del header al desplazarse.
 *
 * Patrón estándar: scroll hacia abajo con intent (más de un par de px, no el
 * primer pixel) oculta el header; cualquier scroll hacia arriba lo muestra;
 * en el tope (scrollY 0) siempre visible. Extraída como función pura para
 * poder testear la lógica sin DOM/rAF real — el caller (SongView.js) solo
 * aporta el scrollY leído en cada frame.
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

const AUTO_HIDE_CLASS = 'header--auto-hide';

/**
 * Engancha el header auto-ocultable en `headerEl`: escucha scroll (passive,
 * rAF-throttled — nunca hace trabajo directo en el evento) y aplica
 * `computeHeaderVisibility` en cada frame. Se desmonta solo vía
 * `onRouteChange` (mismo patrón que el afinador flotante y el
 * SectionPlayer en SongView.js: logout/redirects no deben dejar el listener
 * vivo apuntando a un header ya reemplazado).
 *
 * @param {HTMLElement} headerEl
 * @param {(cb: () => void) => () => void} onRouteChange
 * @returns {() => void} teardown manual (además del automático en route change)
 */
export function attachAutoHideHeader(headerEl, onRouteChange) {
  let lastScrollY = window.scrollY;
  let visible = true;
  let rafId = null;
  // Flag independiente de rafId: marca "ya hay un frame pendiente" ANTES de
  // llamar a requestAnimationFrame, así el orden no importa si el callback
  // corre síncrono (rAF mockeado en tests) — con solo rafId como gate, esa
  // asignación llegaría tarde y el segundo scroll quedaría bloqueado.
  let scheduled = false;

  const applyScroll = () => {
    scheduled = false;
    rafId = null;
    const scrollY = window.scrollY;
    const nextVisible = computeHeaderVisibility({ scrollY, lastScrollY, visible });
    lastScrollY = scrollY;
    if (nextVisible !== visible) {
      visible = nextVisible;
      headerEl.classList.toggle(AUTO_HIDE_CLASS, !visible);
    }
  };

  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    rafId = requestAnimationFrame(applyScroll);
  };

  window.addEventListener('scroll', onScroll, { passive: true });

  const teardown = () => {
    window.removeEventListener('scroll', onScroll);
    if (rafId !== null) cancelAnimationFrame(rafId);
    headerEl.classList.remove(AUTO_HIDE_CLASS);
    unsubscribeRouteChange();
  };
  const unsubscribeRouteChange = onRouteChange(teardown);

  return teardown;
}
