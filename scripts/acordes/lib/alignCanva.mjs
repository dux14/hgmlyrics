// scripts/acordes/lib/alignCanva.mjs
import { normalizeLyric } from './audit.mjs'

/**
 * Similitud detallada por contención sobre palabras normalizadas.
 * Devuelve { conf, inter } donde:
 *   inter = nº de palabras normalizadas en común
 *   conf  = inter / min(|ta|, |tb|)
 * Casos borde: ambos vacíos → {conf:1, inter:0}; uno vacío → {conf:0, inter:0}.
 */
function simDetail(a, b) {
  const na = normalizeLyric(a), nb = normalizeLyric(b)
  if (!na && !nb) return { conf: 1, inter: 0 }
  if (na === nb) {
    const size = na.split(/\s+/).filter(Boolean).length
    return { conf: 1, inter: size }
  }
  const ta = new Set(na.split(/\s+/).filter(Boolean)), tb = new Set(nb.split(/\s+/).filter(Boolean))
  if (!ta.size || !tb.size) return { conf: 0, inter: 0 }
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++
  return { conf: inter / Math.min(ta.size, tb.size), inter }
}

/**
 * Similitud por contención sobre palabras normalizadas: inter / |conjunto menor|.
 * Las líneas Canva suelen ser un fragmento del texto base (melismas, vocalizaciones
 * tipo "sal de ti" ⊂ "Sal de ti, que todo te afecte"). La contención reconoce ese
 * subconjunto donde Jaccard lo penalizaba por la diferencia de longitud.
 */
function sim(a, b) {
  return simDetail(a, b).conf
}

/**
 * Empareja cada línea Canva con la línea base más similar usando asignación global.
 *
 * Algoritmo:
 * 1. Genera todos los pares (ci, bj) con conf >= minConf.
 * 2. Ordena globalmente por: conf desc, inter desc (la línea más completa gana ante
 *    un fragmento), lenDiff asc (longitud más parecida), ci asc, bj asc (determinista).
 * 3. Recorre los pares asignando de forma codiciosa: si ni ci ni bj están usados, asigna.
 * 4. Líneas Canva sin asignar quedan {baseIndex: null, confidence: mejor conf observada}.
 *
 * Complejidad O(C*B) con C líneas Canva y B líneas base.
 */
export function alignLines(canvaLines, baseLines, minConf = 0.6) {
  // Normaliza todos los textos base una sola vez
  const baseNormLen = baseLines.map(b => {
    const nb = normalizeLyric(b)
    return nb ? nb.split(/\s+/).filter(Boolean).length : 0
  })

  // Recoge todos los pares candidatos con conf >= minConf
  const candidates = []
  // También recoge el mejor conf por ci (incluyendo pares < minConf) para el fallback
  const bestConfByCi = new Array(canvaLines.length).fill(0)

  canvaLines.forEach((cl, ci) => {
    const na = normalizeLyric(cl.clean)
    const canvaLen = na ? na.split(/\s+/).filter(Boolean).length : 0

    baseLines.forEach((b, bj) => {
      const { conf, inter } = simDetail(cl.clean, b)
      if (conf > bestConfByCi[ci]) bestConfByCi[ci] = conf
      if (conf >= minConf) {
        const lenDiff = Math.abs(canvaLen - baseNormLen[bj])
        candidates.push({ ci, bj, conf, inter, lenDiff })
      }
    })
  })

  // Ordena: conf desc, inter desc, lenDiff asc, ci asc, bj asc
  candidates.sort((a, b) =>
    b.conf - a.conf ||
    b.inter - a.inter ||
    a.lenDiff - b.lenDiff ||
    a.ci - b.ci ||
    a.bj - b.bj
  )

  // Asignación codiciosa global
  const usedCi = new Set()
  const usedBj = new Set()
  const result = new Array(canvaLines.length).fill(null)

  for (const { ci, bj, conf } of candidates) {
    if (usedCi.has(ci) || usedBj.has(bj)) continue
    result[ci] = { baseIndex: bj, confidence: conf }
    usedCi.add(ci)
    usedBj.add(bj)
  }

  // Rellena los no asignados con baseIndex null + mejor conf observada
  for (let ci = 0; ci < canvaLines.length; ci++) {
    if (result[ci] === null) {
      result[ci] = { baseIndex: null, confidence: bestConfByCi[ci] }
    }
  }

  return result
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
