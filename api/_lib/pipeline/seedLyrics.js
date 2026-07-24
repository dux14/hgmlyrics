/**
 * seedLyrics.js — La letra del cancionero como SEMILLA opcional del gate
 * (decisión 1 del spec 2026-07-24): si `songs.sections` tiene contenido,
 * alimenta la herencia de cortes de renglón y las sugerencias de texto. Sin
 * semilla, el pipeline es IA pura como hasta ahora. Dominio PURO.
 */

/**
 * Aplana la semilla al MISMO orden que projectCanonicalLines (api/_lib/align.js),
 * que es el orden en que dbLines viajó a Modal (ver dbLinesFor en _dispatch.js),
 * agregando la sección y el renglón de origen para poder volver desde un dbIndex.
 * @param {Array} sections `songs.sections`
 * @returns {Array<{dbIndex:number,sectionIdx:number,lineIdx:number,text:string}>}
 */
export function seedIndex(sections) {
  const out = [];
  (sections || []).forEach((section, sectionIdx) => {
    (section.lines || []).forEach((line, lineIdx) => {
      if (line.annotation) return;
      out.push({ dbIndex: out.length, sectionIdx, lineIdx, text: line.text || '' });
    });
  });
  return out;
}

/**
 * Filtra los pares de `perLine` a una subsecuencia NO DECRECIENTE en dbIndex
 * de score total máximo (LIS ponderada). Propósito: descartar el match
 * espurio contra una línea lejana. NO sirve para distinguir instancias de un
 * estribillo repetido —line_scores elige siempre la primera por comparación
 * estricta— y no hace falta: las instancias tienen texto idéntico, así que
 * heredan los mismos cortes.
 * @param {Array<{transIndex:number,dbIndex:number|null,score:number}>} perLine
 * @returns {Array<{transIndex:number,dbIndex:number,score:number}>}
 */
export function monotonicAlign(perLine) {
  const pairs = (perLine || [])
    .filter((p) => Number.isInteger(p?.dbIndex) && typeof p.score === 'number')
    .sort((a, b) => a.transIndex - b.transIndex);
  const n = pairs.length;
  if (n === 0) return [];
  // best[i] = mejor score acumulado de una subsecuencia válida que termina en i.
  const best = pairs.map((p) => p.score);
  const prev = new Array(n).fill(-1);
  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (pairs[j].dbIndex <= pairs[i].dbIndex && best[j] + pairs[i].score > best[i]) {
        best[i] = best[j] + pairs[i].score;
        prev[i] = j;
      }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i += 1) if (best[i] > best[end]) end = i;
  const chain = [];
  for (let i = end; i !== -1; i = prev[i]) chain.unshift(pairs[i]);
  return chain;
}
