// Similitud difusa nombre-de-archivo <-> titulo de cancion (spec: umbral 60%,
// advertencia con override admin). Puro, sin I/O.

const NOISE = /\b(final|live|demo|mix|master|remix|version|v\d+|\d{2,3}\s*kbps|mp3|wav)\b/gi;

export function normalizeTitle(raw) {
  return String(raw ?? '')
    .replace(/\.[a-z0-9]{2,4}$/i, '')      // extension
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')       // tildes
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/[[\](){}]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/^\s*\d{1,3}\s+/, '')         // numero de pista inicial
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

// Score 0..1: max entre ratio Levenshtein del string completo y contencion de
// tokens (para "03 sion ensayo" vs "sion").
export function titleSimilarity(fileName, songTitle) {
  const a = normalizeTitle(fileName);
  const b = normalizeTitle(songTitle);
  if (!a || !b) return 0;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const tokensB = new Set(b.split(' '));
  const hit = b.split(' ').filter((t) => a.includes(t)).length;
  const containment = hit / tokensB.size;
  return Math.max(lev, containment * 0.95);
}

export const TITLE_MATCH_THRESHOLD = 0.6;
