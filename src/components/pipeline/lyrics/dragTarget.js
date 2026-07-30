/**
 * dragTarget.js — geometría del arrastre de renglón, sin DOM.
 *
 * Recibe los rects ya medidos (en coordenadas de DOCUMENTO, no de viewport: el
 * autoscroll mueve el viewport e invalidaría medidas relativas a él) y devuelve
 * el hueco visual donde caería el renglón. La conversión de ese hueco al índice
 * del backend es de `movePayload.js`, no de acá.
 */

/** Hueco dentro de una sección con renglones: el primer renglón cuyo centro
 * queda por debajo del puntero marca el hueco; si ninguno, es el final. */
function gapInSection(section, docY) {
  for (const line of section.lines) {
    if (line.mid > docY) return line.lIdx;
  }
  return section.lines.length;
}

/** Distancia vertical de `docY` al rect de la sección (0 si está dentro). */
function distanceTo(section, docY) {
  if (docY < section.top) return section.top - docY;
  if (docY > section.bottom) return docY - section.bottom;
  return 0;
}

/**
 * @param {Array<{sIdx: number, isBand: boolean, top: number, bottom: number,
 *   lines: Array<{lIdx: number, mid: number}>}>} rects
 * @param {number} docY coordenada Y en el espacio del documento
 * @returns {{toSection: number, toLine: number}|null}
 */
export function dropTargetAt(rects, docY) {
  if (!Array.isArray(rects) || rects.length === 0) return null;

  let best = rects[0];
  let bestDist = Infinity;
  // Comparación estricta (`<`, no `<=`): ante un empate exacto de distancia
  // entre dos secciones, gana la de menor índice (la primera recorrida).
  for (const section of rects) {
    const dist = distanceTo(section, docY);
    if (dist < bestDist) {
      bestDist = dist;
      best = section;
    }
    if (dist === 0) break;
  }

  // La banda instrumental no tiene huecos: se acepta entera como destino y los
  // renglones la reemplazan al soltar (`SheetSection` pinta la banda solo
  // mientras la sección no tiene renglones).
  if (best.isBand) return { toSection: best.sIdx, toLine: 0 };

  return { toSection: best.sIdx, toLine: gapInSection(best, docY) };
}
