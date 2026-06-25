// scripts/acordes/lib/alignCanva.mjs
import { normalizeLyric } from './audit.mjs'

/** Jaccard sobre palabras normalizadas. */
function sim(a, b) {
  const na = normalizeLyric(a), nb = normalizeLyric(b)
  if (!na && !nb) return 1
  if (na === nb) return 1
  const ta = new Set(na.split(/\s+/)), tb = new Set(nb.split(/\s+/))
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.max(ta.size, tb.size, 1)
}

/**
 * Empareja cada línea Canva con la línea base más similar.
 * Conservador: si la mejor similitud es < minConf, devuelve baseIndex null.
 */
export function alignLines(canvaLines, baseLines, minConf = 0.6) {
  const used = new Set()
  return canvaLines.map(cl => {
    let best = -1, bestConf = 0
    baseLines.forEach((b, i) => {
      if (used.has(i)) return
      const c = sim(cl.clean, b)
      if (c > bestConf) { bestConf = c; best = i }
    })
    if (bestConf >= minConf) { used.add(best); return { baseIndex: best, confidence: bestConf } }
    return { baseIndex: null, confidence: bestConf }
  })
}

/**
 * Traslada anotaciones de posición de una línea Canva a su texto base.
 * Si la similitud entre el texto Canva y el texto base es < minConf, descarta todo (conservador).
 */
export function remapPositions(annotations, canvaClean, baseText, minConf = 0.6) {
  if (sim(canvaClean, baseText) < minConf) return []
  // texto limpio ~igual → pos directo, acotado a la longitud del base
  return annotations.filter(a => a.pos <= baseText.length).map(a => ({ ...a }))
}
