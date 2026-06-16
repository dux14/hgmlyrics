// src/lib/voiceoverCover.js
// Mini-portada generativa de una voz en off: gradiente litúrgico + logo gospel.
// Único origen de verdad para el thumbnail (filas, buscador, tracks del álbum).
import { liturgicalPalette, coverGradient } from './liturgicalColor.js';
import { icon } from './icons.js';

/**
 * @param {string|null|undefined} liturgicalColor - 'green'|'purple'|'white'|'red'
 * @param {{size?:number, radius?:number}} [opts]
 * @returns {string} HTML del contenedor cuadrado con el logo centrado
 */
export function voiceoverCoverHtml(liturgicalColor, { size = 48, radius = 8 } = {}) {
  const p = liturgicalPalette(liturgicalColor);
  return (
    `<div class="voz-cover" style="width:${size}px;height:${size}px;border-radius:${radius}px;` +
    `background:${coverGradient(p)};color:${p.accent};">` +
    `${icon('gospel', { size: Math.round(size * 0.52) })}</div>`
  );
}
