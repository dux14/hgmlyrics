// scripts/acordes/lib/titles.mjs

const VOICE_PREFIX_RE = /^(todos|hombres|mujeres|altas|bajas|altos|bajos|coro|voces|solo|solista)\s*[:\-]?\s*/i;

/** Normaliza un título para comparación: sin acentos/emojis/prefijos de voz, minúsculas, espacios colapsados. */
export function normalizeTitle(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27FF}]/gu, '')
    .toLowerCase()
    .replace(VOICE_PREFIX_RE, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distancia de edición clásica. */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Empareja canciones PDF↔BD por título normalizado (exacto, luego fuzzy ≤2).
 * @returns {{pairs:Array<{pdf:object,db:object}>, unmatchedPdf:Array, unmatchedDb:Array}}
 */
export function matchByTitle(pdfSongs, dbSongs) {
  const dbByNorm = new Map(dbSongs.map((d) => [normalizeTitle(d.title), d]));
  const pairs = [];
  const unmatchedPdf = [];
  const matchedDb = new Set();
  for (const p of pdfSongs) {
    const key = normalizeTitle(p.title);
    let db = dbByNorm.get(key);
    if (!db) {
      let best = null;
      let bestD = 3;
      for (const d of dbSongs) {
        const dist = levenshtein(key, normalizeTitle(d.title));
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      db = best;
    }
    if (db && !matchedDb.has(db.id)) {
      pairs.push({ pdf: p, db });
      matchedDb.add(db.id);
    } else {
      unmatchedPdf.push(p);
    }
  }
  const unmatchedDb = dbSongs.filter((d) => !matchedDb.has(d.id));
  return { pairs, unmatchedPdf, unmatchedDb };
}
