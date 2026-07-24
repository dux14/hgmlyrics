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

// Banda de sugerencia: por debajo, el renglón no es esa línea; por encima, ya
// coincide. Las tres erratas del run del 24-jul (57%, 58%, 66%) caen dentro.
// Valores iniciales, calibrables con el primer run posterior a esta tanda.
export const SUGGEST_MIN_SCORE = 0.5;
export const SUGGEST_MAX_SCORE = 0.95;

/** Misma normalización que modal/transcribe_diff.normalize_for_compare:
 * minúsculas, sin diacríticos ni puntuación, espacios colapsados. Duplicada a
 * propósito (el backend no puede importar del árbol de Python), igual que
 * normalizeSectionType en lyricsReview.js. */
function normalizeForCompare(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distancia de edición a nivel carácter (Levenshtein, dos filas). */
function editDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * 1 - CER normalizado por el largo del primer texto, acotado a [0,1]. Mismo
 * criterio que line_scores en modal/transcribe_diff.py.
 * @returns {number}
 */
export function compareScore(text, candidate) {
  const a = normalizeForCompare(text);
  const b = normalizeForCompare(candidate);
  if (!a || !b) return 0;
  return Math.max(0, 1 - editDistance(a, b) / a.length);
}

/**
 * Propuestas de corrección por renglón contra la semilla. Se calcula en el
 * GET, no se persiste — mismo patrón que buildSuggestions (cortes). Compara
 * el renglón TAL COMO QUEDÓ, así que también cubre los que el admin editó.
 * @param {{sections:Array}} doc
 * @param {Array<{text:string}>} seed salida de seedIndex
 * @returns {Array<{section:number,line:number,text:string,score:number}>}
 */
export function buildTextSuggestions(doc, seed) {
  const out = [];
  if (!seed || seed.length === 0) return out;
  (doc?.sections ?? []).forEach((section, sIdx) => {
    (section.lines ?? []).forEach((line, lIdx) => {
      let best = null;
      for (const entry of seed) {
        const score = compareScore(line.text, entry.text);
        if (!best || score > best.score) best = { text: entry.text, score };
      }
      if (!best) return;
      if (best.score < SUGGEST_MIN_SCORE || best.score >= SUGGEST_MAX_SCORE) return;
      if (normalizeForCompare(best.text) === normalizeForCompare(line.text)) return;
      out.push({
        section: sIdx,
        line: lIdx,
        text: best.text,
        score: Math.round(best.score * 10000) / 10000,
      });
    });
  });
  return out;
}
