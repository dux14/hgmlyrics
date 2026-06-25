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
