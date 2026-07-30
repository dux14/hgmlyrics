/**
 * movePayload.js — conversión del hueco visual del arrastre al índice que
 * espera `moveLine` en el backend.
 *
 * Son dos espacios de índice distintos. El gesto razona en huecos visuales:
 * dónde caería el renglón mirando la hoja CON el renglón todavía en su sitio.
 * `applyReviewAction` razona post-remoción: quita el renglón del origen y solo
 * entonces lo inserta (`lyricsReview.js`, case 'moveLine'). Dentro de una misma
 * sección eso corre en uno todos los huecos que están debajo del origen.
 *
 * Los dos huecos que dejan el renglón donde estaba (el de arriba y el de abajo
 * de sí mismo) colapsan al mismo índice, así que descartar el no-op es una sola
 * comparación en vez de dos casos.
 */

/**
 * @param {{fromSection: number, fromLine: number, toSection: number,
 *   toLine: number}|null} target hueco visual del drop
 * @returns {object|null} payload de moveLine, o null si no hay nada que mover
 */
export function moveLinePayload(target) {
  if (!target) return null;
  const { fromSection, fromLine, toSection, toLine } = target;
  if (
    !Number.isInteger(fromSection) ||
    !Number.isInteger(fromLine) ||
    !Number.isInteger(toSection) ||
    !Number.isInteger(toLine)
  ) {
    return null;
  }

  const sameSection = fromSection === toSection;
  const adjusted = sameSection && toLine > fromLine ? toLine - 1 : toLine;
  if (sameSection && adjusted === fromLine) return null;

  return { type: 'moveLine', fromSection, fromLine, toSection, toLine: adjusted };
}
