/**
 * measure-align-stats.mjs
 *
 * Funciones puras (sin I/O, sin red) usadas por measure-align.mjs para calcular
 * estadísticas de precisión del alignment. Separadas del script principal para
 * poder testearlas de forma aislada con Vitest.
 */

/** Media aritmética. Lanza si el array está vacío. */
export function mean(values) {
  if (values.length === 0) throw new Error('mean: array vacío');
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Mediana (promedio de los dos centrales si la longitud es par). */
export function median(values) {
  if (values.length === 0) throw new Error('median: array vacío');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

/**
 * Percentil por el método "nearest-rank" (sin interpolación entre valores):
 * rank = ceil(p/100 * n), acotado a [1, n], índice 0-based = rank - 1.
 * Para p90 sobre 10 valores ordenados, toma el 9º valor.
 */
export function percentile(values, p) {
  if (values.length === 0) throw new Error('percentile: array vacío');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[index];
}

/** Percentil 90, método nearest-rank (ver percentile()). */
export function p90(values) {
  return percentile(values, 90);
}

/**
 * Coeficiente de correlación de Pearson entre dos arrays de igual longitud.
 * Devuelve 0 si no hay varianza en alguno de los dos (evita división por 0).
 */
export function pearson(xs, ys) {
  if (xs.length !== ys.length) throw new Error('pearson: arrays de distinta longitud');
  if (xs.length === 0) throw new Error('pearson: arrays vacíos');
  const mx = mean(xs);
  const my = mean(ys);
  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;
  for (let idx = 0; idx < xs.length; idx += 1) {
    const dx = xs[idx] - mx;
    const dy = ys[idx] - my;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }
  const denominator = Math.sqrt(sumSqX * sumSqY);
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Empareja líneas de ground-truth con líneas nuevas por índice `i` (NO por
 * posición del array — el orden puede variar entre exports). Usa un Map por
 * cada lado; ignora líneas sin contraparte en el otro lado y las reporta
 * como huérfanas para que el caller pueda avisar.
 *
 * @param {Array<{i:number}>} gtLines
 * @param {Array<{i:number}>} newLines
 * @returns {{ pairs: Array<{i:number, gt:object, next:object}>, orphanGt: number[], orphanNew: number[] }}
 */
export function matchByIndex(gtLines, newLines) {
  const gtMap = new Map(gtLines.map((line) => [line.i, line]));
  const newMap = new Map(newLines.map((line) => [line.i, line]));
  const pairs = [];
  const orphanGt = [];
  for (const [i, gt] of gtMap) {
    const next = newMap.get(i);
    if (next === undefined) {
      orphanGt.push(i);
      continue;
    }
    pairs.push({ i, gt, next });
  }
  const orphanNew = [...newMap.keys()].filter((i) => !gtMap.has(i));
  pairs.sort((a, b) => a.i - b.i);
  orphanGt.sort((a, b) => a - b);
  orphanNew.sort((a, b) => a - b);
  return { pairs, orphanGt, orphanNew };
}
