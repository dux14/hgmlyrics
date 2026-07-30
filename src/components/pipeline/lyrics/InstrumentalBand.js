/**
 * InstrumentalBand.js — banda de tramo instrumental de la hoja viva de
 * revisión de letra (S3a, Task 6). `SheetSection` la pinta en vez del
 * cuerpo cuando `normalizeSectionType(section.type) === 'instrumental'` Y la
 * sección no tiene renglones — el tipo manda, no el contenido: una sección
 * `instrumental` con renglones de texto pinta esos renglones igual, nunca
 * esconde texto (ver `docs/plans/2026-07-30-revision-letra-s3a-notes.md`).
 *
 * Trama diagonal + borde punteado, color `--color-section-neutral` (token
 * que consume la clase `.sheet-instrumental`; el CSS lo escribe la Task 8).
 */
import { icon } from '../../../lib/icons.js';

function pad2(n) {
  return n.toString().padStart(2, '0');
}

function formatMmSs(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSec / 60)}:${pad2(totalSec % 60)}`;
}

/** Rango + duración en segundos, o cadena vacía si faltan startMs/endMs —
 * envelopes colapsados o ausentes no deben reventar el render. */
function rangeText(section) {
  if (typeof section.startMs !== 'number' || typeof section.endMs !== 'number') return '';
  const durationSec = Math.max(0, Math.round((section.endMs - section.startMs) / 1000));
  return `${formatMmSs(section.startMs)} – ${formatMmSs(section.endMs)} · ${durationSec} s`;
}

/**
 * @param {{section: object}} opts
 * @returns {HTMLElement}
 */
export function InstrumentalBand({ section }) {
  const el = document.createElement('div');
  el.className = 'sheet-instrumental';

  function render() {
    const range = rangeText(section);
    el.innerHTML = `
      <span class="sheet-instrumental__icon" aria-hidden="true">${icon('music', { size: 14 })}</span>
      <span class="sheet-instrumental__label">Solo música</span>
      ${range ? `<span class="sheet-instrumental__range">${range}</span>` : ''}
    `;
  }

  render();

  el.update = function update(nextSection) {
    section = nextSection;
    render();
  };

  // Conmuta una clase y nada más, mismo patrón que SheetLine.setActive: el
  // resaltado corre a la cadencia del transporte, un update()/render() por
  // tick sería carísimo.
  el.setActive = (on) => el.classList.toggle('is-sounding', on);

  return el;
}
