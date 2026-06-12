/**
 * StudioSectionTimeline.js — Lista vertical de secciones estructurales (SongFormer).
 * Namespace CSS: .studio-sectl*  (no colisiona con .studio-tl* de voces)
 */
import { labelColor } from '../lib/studioSegments.js';
import { fmtTime } from './StudioPlayer.js';

/** Capitaliza la primera letra de un string. */
function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Construye la lista de secciones y la leyenda de labels únicos.
 *
 * @param {{label:string, start:number, end:number}[]} segments
 * @param {{ onSeek?: (startS: number) => void }} [opts]
 * @returns {HTMLElement}  raíz del componente (.studio-sectl)
 */
export function renderTimeline(segments, { onSeek } = {}) {
  const root = document.createElement('div');
  root.className = 'studio-sectl';

  if (!Array.isArray(segments) || segments.length === 0) return root;

  const list = document.createElement('ul');
  list.className = 'studio-sectl__list';

  for (const seg of segments) {
    const row = document.createElement('li');
    row.className = 'studio-sectl__row';
    row.dataset.start = String(seg.start);
    row.dataset.end = String(seg.end);

    // Barra de color
    const bar = document.createElement('span');
    bar.className = 'studio-sectl__bar';
    bar.style.background = labelColor(seg.label);

    // Etiqueta capitalizada
    const labelEl = document.createElement('span');
    labelEl.className = 'studio-sectl__label';
    labelEl.textContent = capitalize(seg.label);

    // Rango m:ss–m:ss (en-dash U+2013)
    const rangeEl = document.createElement('span');
    rangeEl.className = 'studio-sectl__range';
    rangeEl.textContent = `${fmtTime(seg.start)}–${fmtTime(seg.end)}`;

    row.appendChild(bar);
    row.appendChild(labelEl);
    row.appendChild(rangeEl);

    // Click → onSeek con el start numérico del segmento
    row.addEventListener('click', () => {
      if (typeof onSeek === 'function') onSeek(seg.start);
    });

    list.appendChild(row);
  }

  root.appendChild(list);

  // Leyenda: un swatch + nombre por cada label único presente
  const seen = new Map(); // label → color (orden de primera aparición)
  for (const seg of segments) {
    if (!seen.has(seg.label)) seen.set(seg.label, labelColor(seg.label));
  }

  const legend = document.createElement('div');
  legend.className = 'studio-sectl__legend';

  for (const [lbl, color] of seen) {
    const item = document.createElement('span');
    item.className = 'studio-sectl__legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'studio-sectl__swatch';
    swatch.style.background = color;

    const name = document.createElement('span');
    name.textContent = capitalize(lbl);

    item.appendChild(swatch);
    item.appendChild(name);
    legend.appendChild(item);
  }

  root.appendChild(legend);

  return root;
}

/**
 * Marca la fila activa según currentTimeS.
 * Añade .studio-sectl__row--active a la fila cuyo rango [start, end) contiene
 * currentTimeS y la quita de las demás. Muta el DOM en-lugar, sin re-render.
 *
 * @param {HTMLElement} rootEl  elemento devuelto por renderTimeline
 * @param {number} currentTimeS
 */
export function markActive(rootEl, currentTimeS) {
  const rows = rootEl.querySelectorAll('.studio-sectl__row');
  rows.forEach(row => {
    const start = parseFloat(row.dataset.start);
    const end = parseFloat(row.dataset.end);
    const active = currentTimeS >= start && currentTimeS < end;
    row.classList.toggle('studio-sectl__row--active', active);
  });
}
