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
 * Tokeniza un texto en palabras con sus offsets de carácter (start inclusivo, end exclusivo).
 * Devuelve [{word, start, end, norm}] donde norm es la forma normalizada para comparar.
 */
function tokenize(text) {
  const tokens = []
  const re = /\S+/g
  let m
  while ((m = re.exec(text)) !== null) {
    tokens.push({
      word: m[0],
      start: m.index,
      end: m.index + m[0].length,
      norm: normalizeLyric(m[0]),
    })
  }
  return tokens
}

/**
 * Alinea palabras Canva → base como subsecuencia monótona.
 * Devuelve un array paralelo a canvaTokens: cada posición tiene el token base alineado
 * (o null si esa palabra Canva no encontró match).
 */
function alignTokens(canvaTokens, baseTokens) {
  const aligned = new Array(canvaTokens.length).fill(null)
  let ptr = 0
  for (let ci = 0; ci < canvaTokens.length; ci++) {
    const cn = canvaTokens[ci].norm
    if (!cn) continue
    for (let bi = ptr; bi < baseTokens.length; bi++) {
      if (baseTokens[bi].norm === cn) {
        aligned[ci] = baseTokens[bi]
        ptr = bi + 1
        break
      }
    }
  }
  return aligned
}

/**
 * Traslada anotaciones de posición de una línea Canva a su texto base.
 * Si la similitud entre el texto Canva y el texto base es < minConf, descarta todo (conservador).
 *
 * Algoritmo:
 * 1. Tokeniza ambos textos con offsets de carácter.
 * 2. Alinea palabras Canva→base como subsecuencia monótona (cubre fragmento ⊂ base).
 * 3. Para cada anotación localiza la palabra Canva que la contiene y traslada
 *    aplicando el offset intra-palabra al token base alineado.
 * 4. Palabras sin match: ancla al final de la última palabra base alineada (best-effort).
 */
export function remapPositions(annotations, canvaClean, baseText, minConf = 0.6) {
  if (sim(canvaClean, baseText) < minConf) return []

  const canvaTokens = tokenize(canvaClean)
  const baseTokens = tokenize(baseText)
  const aligned = alignTokens(canvaTokens, baseTokens)

  // Última posición base alineada, para anclar palabras sin match
  let lastBaseEnd = 0
  for (const bt of aligned) {
    if (bt !== null) lastBaseEnd = bt.end
  }

  return annotations.map(a => {
    const pos = a.pos

    // Caso: pos al final del texto Canva (fuera de cualquier token)
    if (pos >= canvaClean.length) {
      return { ...a, pos: Math.min(lastBaseEnd, baseText.length) }
    }

    // Localiza el token Canva que contiene pos (start <= pos < end)
    // Si pos cae en espacio, toma el siguiente token a o después de pos
    let ci = canvaTokens.findIndex(t => t.start <= pos && pos < t.end)
    if (ci === -1) {
      // pos en espacio: busca el primer token que empiece >= pos
      ci = canvaTokens.findIndex(t => t.start >= pos)
    }

    if (ci === -1) {
      // pos más allá del último token
      return { ...a, pos: Math.min(lastBaseEnd, baseText.length) }
    }

    const ct = canvaTokens[ci]
    const bt = aligned[ci]
    const intra = Math.max(0, pos - ct.start)

    let newPos
    if (bt !== null) {
      newPos = bt.start + Math.min(intra, bt.end - bt.start)
    } else {
      // Palabra sin match: ancla al final de la última palabra base alineada
      // o al inicio de la siguiente palabra base alineada que exista
      let fallback = lastBaseEnd
      // busca primera alineada posterior a ci
      for (let j = ci + 1; j < aligned.length; j++) {
        if (aligned[j] !== null) { fallback = aligned[j].start; break }
      }
      newPos = fallback
    }

    return { ...a, pos: Math.max(0, Math.min(newPos, baseText.length)) }
  })
}
