import { expandVoices } from './voiceMap.mjs'

// Combinaciones multi-token separadas por dos puntos (greedy para capturar todos los tokens)
const COLON_PREFIX = /^([A-ZÁÉÍÓÚÑ,\s]*?(?:TODOS|CORO|VOCES|HOMBRES|MUJERES|ALTAS|BAJAS|ALTOS|BAJOS|SOLISTA|SOLO)[A-ZÁÉÍÓÚÑ,\sY]*)\s*:\s+(.+)$/
// Token único seguido de espacio + texto (plan original; lazy suffix no funciona con multi-token+colon)
const SPACE_PREFIX = /^((?:TODOS|CORO|VOCES|HOMBRES|MUJERES|ALTAS|BAJAS|ALTOS|BAJOS|SOLISTA|SOLO))\s+(.+)$/

export function parseVoiceMarker(line) {
  const trimmed = line.trim()
  // Línea sola: todo el contenido es marcador
  const whole = expandVoices(trimmed)
  if (whole && /^[A-ZÁÉÍÓÚÑ,\s:Y]+$/.test(trimmed)) {
    return { mode: 'block', voices: whole, clean: '' }
  }
  // Prefijo inline — probar colon primero (multi-token), luego espacio (token único)
  let m = trimmed.match(COLON_PREFIX)
  if (m) {
    const voices = expandVoices(m[1])
    if (voices) return { mode: 'inline', voices, clean: m[2].trim() }
  }
  m = trimmed.match(SPACE_PREFIX)
  if (m) {
    const voices = expandVoices(m[1])
    if (voices) return { mode: 'inline', voices, clean: m[2].trim() }
  }
  return null
}

// (1) Anotación entre paréntesis con vocales repetidas y guiones: (aaa-aaa-aaa) / (* aaa-aa-aaa)
const PAREN_STRETCH = /\s*\(\*?\s*([aeiou])(?:\1|-)*\1\s*\)/giu
// (2) Vocal repetida (>=3) opcionalmente con guiones internos: tiii-iiii, eternidaaaad
// Dash-form first so tiii-iiii matches as a single token before \1{2,} splits it
const INLINE_STRETCH = /([aeiou])(?:(?:\1*-\1+)+|\1{2,})/giu

export function parseStretches(line) {
  const stretches = []
  // Paso 1: quitar anotaciones entre paréntesis (registran un stretch en su posición de inserción)
  let clean = line.replace(PAREN_STRETCH, (mm, _v, off) => { stretches.push({ _at: off, len: countLen(mm) }); return '' })
  clean = clean.replace(/\s{2,}/g, ' ').trim()
  // Paso 2: colapsar vocales repetidas a la forma corta, anotando pos/len en coordenadas de `clean`
  const out = []
  let result = ''
  INLINE_STRETCH.lastIndex = 0
  let last = 0, m
  while ((m = INLINE_STRETCH.exec(clean))) {
    result += clean.slice(last, m.index)
    const pos = result.length
    result += m[1] // forma corta: una sola vocal
    out.push({ pos, len: countLen(m[0]) })
    last = m.index + m[0].length
  }
  result += clean.slice(last)
  // los stretches de paréntesis ya no tienen pos válida tras el colapso → se anclan al inicio de palabra previa (best-effort)
  return { clean: result, stretches: out.length ? out : stretches.map(s => ({ pos: 0, len: s.len })) }
}

function countLen(s) { return (s.match(/[aeiou]/giu) || []).length }

const BEND = { '↗': 'up', '↘': 'down', '〰': 'wave', '➡': 'flat' }
const BEND_RE = /([↗↘〰➡])️?/gu

export function parseBends(line) {
  const bends = []
  // map[i] = índice en clean correspondiente al índice i en line.
  // Para índices borrados (dentro de una flecha), apunta al borde derecho (monótono no decreciente).
  const map = new Array(line.length + 1)
  let result = '', last = 0, m
  BEND_RE.lastIndex = 0
  while ((m = BEND_RE.exec(line))) {
    const chunk = line.slice(last, m.index)
    for (let i = 0; i < chunk.length; i++) map[last + i] = result.length + i
    result += chunk
    bends.push({ pos: result.length, dir: BEND[m[1]] })
    // índices del span de la flecha → apuntan al borde derecho (= result.length, la pos post-flecha)
    for (let i = 0; i < m[0].length; i++) map[m.index + i] = result.length
    last = m.index + m[0].length
  }
  const tail = line.slice(last)
  for (let i = 0; i < tail.length; i++) map[last + i] = result.length + i
  result += tail
  map[line.length] = result.length
  return { clean: result, bends, map }
}

// Escaneo único: directiva entre corchetes | palabra-marcador | emoji de producción.
// (1)=corchete completo, (2)=interior del corchete, (3)=palabra, (4)=emoji.
const DIRECTIVE_SCAN =
  /(\[([^\]]+?)\s*\d*\])|\b(TIEMPOS?|VUELTAS|SILENCIO|PAUSA|MELOD[IÍ]A|INSTRUMENTAL|INSTRUMENTOS|GUITARRA|PIANO|ENTRAN|REPITE|SEGUNDO)\b|(\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}]*)/giu

/**
 * Colapsa espacios repetidos + recorta, remapeando cada posición a través de la
 * transformación (vía mapa de índices) para que `pos` siga apuntando al carácter
 * correcto del texto resultante. Sin esto, las directivas quedaban en coordenadas
 * de la cadena pre-colapso y se desalineaban.
 */
function collapseWithPositions(s, positions) {
  let out = ''
  const map = new Array(s.length + 1)
  let prevSpace = true // arranca como espacio → descarta espacios líderes
  for (let i = 0; i < s.length; i++) {
    map[i] = out.length
    if (/\s/.test(s[i])) {
      if (!prevSpace) out += ' '
      prevSpace = true
    } else {
      out += s[i]
      prevSpace = false
    }
  }
  map[s.length] = out.length
  out = out.replace(/\s+$/, '')
  const remap = positions.map(p => Math.min(map[p] ?? out.length, out.length))
  return { text: out, positions: remap, map }
}

export function parseDirectives(line, glossary = {}) {
  const raw = []
  // deletionMap[i] = índice en `result` correspondiente al índice i en `line`
  // (índices dentro de directivas borradas apuntan al borde derecho — monótono no decreciente)
  const deletionMap = new Array(line.length + 1)
  let result = '', last = 0, m
  DIRECTIVE_SCAN.lastIndex = 0
  while ((m = DIRECTIVE_SCAN.exec(line))) {
    const [full, , bracketInner, word, emoji] = m
    const chunk = line.slice(last, m.index)
    for (let i = 0; i < chunk.length; i++) deletionMap[last + i] = result.length + i
    result += chunk
    const pos = result.length // posición en la cadena que estamos construyendo (consistente)
    if (emoji) {
      raw.push({ kind: glossary[emoji] ?? 'instrumental', pos, raw: emoji })
    } else {
      const kind = (bracketInner ?? word).toLowerCase().replace(/\s*\d+$/, '').trim()
      raw.push({ kind, pos, raw: full })
    }
    // índices del span borrado → borde derecho (= result.length, la pos post-directiva)
    for (let i = 0; i < full.length; i++) deletionMap[m.index + i] = result.length
    last = m.index + full.length
  }
  const tail = line.slice(last)
  for (let i = 0; i < tail.length; i++) deletionMap[last + i] = result.length + i
  result += tail
  deletionMap[line.length] = result.length

  const { text, positions, map: collapseMap } = collapseWithPositions(result, raw.map(d => d.pos))
  const directives = raw.map((d, i) => ({ ...d, pos: positions[i] }))

  // map compuesto: índice en `line` → índice en `text` (clean final)
  // Para cada índice i en line: primero deletionMap[i] → posición en result,
  // luego collapseMap[pos en result] → posición en text.
  const map = deletionMap.map(p => Math.min(collapseMap[p] ?? text.length, text.length))

  return { clean: text, directives, map }
}

// Aplica un mapa de deleción/colapso a una posición, clampando al último valor si pos >= map.length.
function applyMap(pos, map) {
  return map[Math.min(pos, map.length - 1)] ?? map[map.length - 1] ?? 0
}

/**
 * Centraliza el parseo de una línea Canva: marcador de voz → stretches → bends → directivas,
 * reenviando las coordenadas de stretches y bends al espacio del clean final.
 */
export function parseCanvaLine(line, glossary = {}) {
  const marker = parseVoiceMarker(line)
  const text0 = marker ? marker.clean : line

  // (1) Stretches — pos en coords de s.clean
  const s = parseStretches(text0)

  // (2) Bends — reenvía stretch.pos a través del mapa de deleción de bends
  const b = parseBends(s.clean)
  const stretchesAfterBends = s.stretches.map(st => ({
    ...st,
    pos: applyMap(st.pos, b.map),
  }))

  // (3) Directivas — reenvía stretch.pos y bend.pos a través del mapa compuesto de directivas
  const d = parseDirectives(b.clean, glossary)
  const clean = d.clean
  const len = clean.length

  const stretches = stretchesAfterBends.map(st => ({
    ...st,
    pos: Math.min(applyMap(st.pos, d.map), len),
  }))
  const bends = b.bends.map(bd => ({
    ...bd,
    pos: Math.min(applyMap(bd.pos, d.map), len),
  }))

  return { marker, clean, stretches, bends, directives: d.directives }
}
