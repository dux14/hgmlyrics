// scripts/acordes/lib/chords.mjs

// Detección amplia de acorde (formato del PDF): admite varios dígitos / extensiones.
export const CHORD_RE = /^[A-G](#|b)?(m|maj|min|dim|aug|sus|add)?\d*([#b]\d*)*(\/[A-G](#|b)?)?$/;

// Gramática estricta del importador (parseLineChords): una cualidad + un dígito + bajo opcional.
export const INLINE_CHORD_RE = /^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?[0-9]?(?:\/[A-G][#b]?)?$/;

/** @param {string} str */
export function isChord(str) {
  const t = (str || '').trim();
  return t.length > 0 && CHORD_RE.test(t);
}

/** @param {{text:string}} line */
export function isChordLine(line) {
  const tokens = ((line && line.text) || '').trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(isChord);
}

/** ¿El acorde sobrevive el round-trip por el importador inline? @param {string} ch */
export function isInlineableChord(ch) {
  return INLINE_CHORD_RE.test((ch || '').trim());
}

/**
 * Mapea la x de un acorde al índice de carácter más cercano dentro de la línea de letra.
 * Asume ancho/char ~constante dentro de cada item (ancho del item / nº chars).
 * El índice resultante ES chords[].pos (mismo contrato que render e importador).
 * @param {number} chordX
 * @param {{items:Array<{str:string,x:number,width:number}>}} lyricLine
 * @returns {number}
 */
export function xToCharIndex(chordX, lyricLine) {
  const items = (lyricLine && lyricLine.items) || [];
  if (items.length === 0) return 0;
  let best = { idx: 0, dist: Infinity };
  let globalIdx = 0;
  for (const it of items) {
    const n = (it.str || '').length;
    const charW = n > 0 ? it.width / n : 0;
    for (let i = 0; i <= n; i++) {
      const x = it.x + i * charW;
      const dist = Math.abs(x - chordX);
      if (dist < best.dist) best = { idx: globalIdx + i, dist };
    }
    globalIdx += n;
  }
  return best.idx;
}
