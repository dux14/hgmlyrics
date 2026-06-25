// scripts/acordes/lib/columns.mjs
/**
 * Separa items de texto del PDF en columna izquierda/derecha por coordenada x.
 * @param {Array<{x:number}>} items
 * @param {number} threshold
 * @returns {{left:Array, right:Array}}
 */
export function splitColumns(items, threshold = 290) {
  const left = [];
  const right = [];
  for (const it of items) {
    (it.x < threshold ? left : right).push(it);
  }
  return { left, right };
}
