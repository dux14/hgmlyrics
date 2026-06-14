/**
 * studioActionButton.js — Máquina de estados visual de un botón de acción del
 * Estudio (ZIP / Drive). Controla SOLO el <button> que recibe: no toca elementos
 * vecinos (el chip de error lo maneja el caller). Toda la animación (pop, shake,
 * transiciones) vive en CSS y respeta prefers-reduced-motion; aquí solo se
 * conmutan clases, el ancho del fill, el icono y el texto.
 */
import { icon } from './icons.js';

const STATE_CLASSES = ['is-busy', 'is-done', 'is-error'];
const RESTORE_MS = 1400;

/**
 * @param {HTMLButtonElement} btnEl
 * @param {{ idle: { icon: string, label: string } }} config
 */
export function createActionButton(btnEl, { idle }) {
  btnEl.className = 'studio-action';

  const fill = document.createElement('span');
  fill.className = 'studio-action__fill';
  const ico = document.createElement('span');
  ico.className = 'studio-action__ico';
  const lbl = document.createElement('span');
  lbl.className = 'studio-action__lbl';

  btnEl.replaceChildren(fill, ico, lbl);

  let restoreTimer = null;

  function setIcon(name) {
    ico.innerHTML = name ? icon(name, { size: 16 }) : '';
  }
  function setState(cls) {
    btnEl.classList.remove(...STATE_CLASSES);
    if (cls) btnEl.classList.add(cls);
  }
  function clearTimer() {
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }
  }

  function paintIdle() {
    setState(null);
    fill.style.width = '0%';
    setIcon(idle.icon);
    lbl.textContent = idle.label;
  }

  paintIdle();

  return {
    busy(label) {
      clearTimer();
      setState('is-busy');
      fill.style.width = '0%';
      setIcon(idle.icon);
      lbl.textContent = label;
    },
    progress(fraction) {
      const pct = Math.max(0, Math.min(1, fraction)) * 100;
      fill.style.width = `${pct}%`;
    },
    done(label) {
      clearTimer();
      setState('is-done');
      fill.style.width = '100%';
      setIcon('check-circle');
      lbl.textContent = label;
      restoreTimer = setTimeout(() => this.reset(), RESTORE_MS);
    },
    error(label = 'Reintentar') {
      clearTimer();
      setState('is-error');
      fill.style.width = '0%';
      setIcon('rotate-ccw');
      lbl.textContent = label;
    },
    reset() {
      clearTimer();
      paintIdle();
    },
  };
}
