// src/lib/liturgicalColor.js
// Paletas litúrgicas derivadas de liturgical_color (campo del ordo).
// Colores generativos para covers y separadores; sin assets de imagen.

/** @type {Record<string, { bg: string, accent: string, text: string, label: string }>} */
export const LITURGICAL_PALETTES = {
  green: { bg: '#1a3a2a', accent: '#4caf82', text: '#d4f0e5', label: 'Tiempo Ordinario' },
  purple: { bg: '#2a1a3a', accent: '#9c6abf', text: '#e8d4f0', label: 'Adviento / Cuaresma' },
  white: { bg: '#1e2a3a', accent: '#e8d5a0', text: '#f5f0e8', label: 'Pascua / Fiestas' },
  red: { bg: '#3a1a1a', accent: '#e05a5a', text: '#f0d4d4', label: 'Pentecostés / Mártires' },
};

const FALLBACK = { bg: '#1a1a2a', accent: '#6a7abf', text: '#d4d8f0', label: '' };

/**
 * Devuelve la paleta litúrgica para un color del ordo.
 * @param {string|null|undefined} color - 'green'|'purple'|'white'|'red' (u otro)
 * @returns {{ bg: string, accent: string, text: string, label: string }}
 */
export function liturgicalPalette(color) {
  return LITURGICAL_PALETTES[color] ?? FALLBACK;
}

/**
 * Genera el CSS del degradado de portada para una paleta litúrgica.
 * @param {{ bg: string, accent: string }} palette
 * @returns {string} valor CSS para `background`
 */
export function coverGradient(palette) {
  return `linear-gradient(135deg, ${palette.bg} 0%, color-mix(in srgb, ${palette.accent} 20%, ${palette.bg}) 100%)`;
}
