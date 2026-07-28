// src/lib/voiceoverHero.js
// Deriva la jerarquía del hero de "voces en off" (píldora, título grande,
// línea meta) a partir de un weekly_word. Puro: sin DOM, sin escape de HTML
// (responsabilidad del componente que renderiza).
import { liturgicalPalette } from './liturgicalColor.js';

/**
 * Limpia el título litúrgico: quita el prefijo de fecha/día ("14. ") y el
 * color litúrgico final (ya se muestra en la píldora).
 * @param {string|null|undefined} title
 * @returns {string}
 */
function cleanLiturgicalTitle(title) {
  if (!title) return '';
  let t = String(title).trim();
  const dotIdx = t.indexOf('. ');
  if (dotIdx !== -1 && /\d/.test(t.slice(0, dotIdx))) {
    t = t.slice(dotIdx + 2);
  }
  return t.replace(/,\s*(verde|morado|blanco|rojo|rosa|rosáceo|púrpura|violeta)\s*$/i, '').trim();
}

/**
 * Formatea una fecha ISO (YYYY-MM-DD o timestamp completo) como "15 de junio de 2026".
 * @param {string|null|undefined} isoDate
 * @returns {string}
 */
function formatSundayDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('es', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Deriva la jerarquía del hero de una voz en off (weekly_word).
 * @param {{ liturgical_title?: string|null, gospel_ref?: string|null, sunday_date?: string|null, liturgical_color?: string|null }} word
 * @returns {{ pillLabel: string, bigTitle: string, metaLine: string }}
 */
export function voiceoverHero(word) {
  const bigTitle = cleanLiturgicalTitle(word.liturgical_title) || word.gospel_ref || '';
  const pillLabel = liturgicalPalette(word.liturgical_color).label;
  const dateLabel = formatSundayDate(word.sunday_date);
  const metaLine = [dateLabel, word.gospel_ref].filter(Boolean).join(' · ');
  return { pillLabel, bigTitle, metaLine };
}
