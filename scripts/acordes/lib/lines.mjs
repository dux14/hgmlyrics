// scripts/acordes/lib/lines.mjs
/**
 * Agrupa items en líneas por coordenada y (con tolerancia para baseline).
 * Devuelve líneas ordenadas de arriba a abajo; items de cada línea ordenados por x.
 * @param {Array<{str:string,x:number,y:number,width:number}>} items
 * @param {number} yTol
 * @returns {Array<{y:number,items:Array,text:string}>}
 */
export function groupLines(items, yTol = 3) {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines = [];
  for (const it of sorted) {
    let line = lines.find((l) => Math.abs(l.y - it.y) <= yTol);
    if (!line) {
      line = { y: it.y, items: [] };
      lines.push(line);
    }
    line.items.push(it);
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str).join('');
  }
  return lines;
}
