// scripts/acordes/lib/alignCanva.mjs
import { normalizeLyric } from './audit.mjs'

/**
 * Similitud por contención sobre palabras normalizadas: inter / |conjunto menor|.
 * Las líneas Canva suelen ser un fragmento del texto base (melismas, vocalizaciones
 * tipo "sal de ti" ⊂ "Sal de ti, que todo te afecte"). La contención reconoce ese
 * subconjunto donde Jaccard lo penalizaba por la diferencia de longitud.
 */
function sim(a, b) {
  const na = normalizeLyric(a), nb = normalizeLyric(b)
  if (!na && !nb) return 1
  if (na === nb) return 1
  const ta = new Set(na.split(/\s+/).filter(Boolean)), tb = new Set(nb.split(/\s+/).filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.min(ta.size, tb.size)
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
