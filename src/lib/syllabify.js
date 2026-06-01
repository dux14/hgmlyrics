/**
 * syllabify.js — utilidades puras de silabación manual.
 * Un "boundary" es un índice de corte dentro de text (0 < b < text.length).
 */

/** @param {string} text @param {number[]} boundaries @returns {Array<{start:number,end:number}>} */
export function boundariesToSyllables(text, boundaries) {
  if (!text) return [];
  const pts = [0, ...[...boundaries].sort((a, b) => a - b), text.length];
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i] < pts[i + 1]) out.push({ start: pts[i], end: pts[i + 1] });
  }
  return out;
}

/** @param {Array<{start:number,end:number}>} syllables @returns {number[]} cortes internos */
export function syllablesToBoundaries(syllables) {
  return (syllables || []).slice(1).map((s) => s.start);
}

/**
 * Agrega o quita un corte. Ignora 0 y text.length.
 * @param {number[]} boundaries
 * @param {number} index
 * @param {number} [textLength=Infinity]
 * @returns {number[]}
 */
export function toggleBoundary(boundaries, index, textLength = Infinity) {
  if (index <= 0 || index >= textLength) return [...boundaries];
  const set = new Set(boundaries);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  return [...set].sort((a, b) => a - b);
}

/**
 * Divide una línea en tokens con offsets de carácter para colocar acordes.
 * Usa line.syllables (ignorando extensores de ancho cero) si existen;
 * si no, tokeniza por palabras. Cada token: {text, start, end}.
 * @param {{text?:string, syllables?:Array<{start:number,end:number}>}} line
 * @returns {Array<{text:string,start:number,end:number}>}
 */
export function tokenizeLineForChords(line) {
  const text = line?.text || '';
  const syllables = (line?.syllables || []).filter((s) => s.end > s.start);
  if (syllables.length > 0) {
    return syllables.map((s) => ({ text: text.slice(s.start, s.end), start: s.start, end: s.end }));
  }
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/**
 * Heurística de silabación para español (editable por el usuario):
 * sugiere un corte antes de la consonante que abre la siguiente sílaba.
 * Regla simple: si una consonante va seguida de vocal y viene precedida de
 * vocal o consonante, se corta justo antes de esa consonante (V·CV o VC·CV).
 * NO es perfecta — es un acelerador; la verdad es manual.
 * @param {string} text @returns {number[]}
 */
export function autoSuggestBoundaries(text) {
  const isVowel = (c) => /[aeiouáéíóúü]/i.test(c);
  const isCons = (c) => /[a-záéíóúüñ]/i.test(c) && !isVowel(c);
  const out = [];
  for (let i = 1; i < text.length - 1; i++) {
    const prev = text[i - 1];
    const cur = text[i];
    const next = text[i + 1];
    // Corte antes de una consonante que abre sílaba (cur cons + next vocal),
    // siempre que lo anterior cierre la sílaba previa (vocal o consonante).
    if (isCons(cur) && isVowel(next) && (isVowel(prev) || isCons(prev))) {
      out.push(i);
    }
  }
  return out;
}
