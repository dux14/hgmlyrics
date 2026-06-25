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
  let result = '', last = 0, m
  BEND_RE.lastIndex = 0
  while ((m = BEND_RE.exec(line))) {
    result += line.slice(last, m.index)
    bends.push({ pos: result.length, dir: BEND[m[1]] })
    last = m.index + m[0].length
  }
  result += line.slice(last)
  return { clean: result, bends }
}

const TEXT_DIRECTIVE = /\[([^\]]+?)\s*\d*\]|\b(TIEMPOS?|VUELTAS|SILENCIO|PAUSA|MELOD[IÍ]A|INSTRUMENTAL|INSTRUMENTOS|GUITARRA|PIANO|ENTRAN|REPITE|SEGUNDO)\b/giu
const EMOJI_RE = /\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}]*/gu

export function parseDirectives(line, glossary = {}) {
  const directives = []
  // 1) marcadores de texto (no se borran del clean si son inline de letra; se borran si es marcador solo)
  let clean = line.replace(TEXT_DIRECTIVE, (mm, br, word, off) => {
    directives.push({ kind: (br ?? word).toLowerCase().replace(/\s*\d+$/, '').trim(), pos: off, raw: mm })
    return ''
  })
  // 2) emojis (excepto bends, ya consumidos): kind desde el glosario de la canción
  let result = '', last = 0, m
  EMOJI_RE.lastIndex = 0
  while ((m = EMOJI_RE.exec(clean))) {
    result += clean.slice(last, m.index)
    const raw = m[0]
    directives.push({ kind: glossary[raw] ?? 'instrumental', pos: result.length, raw })
    last = m.index + m[0].length
  }
  result += clean.slice(last)
  return { clean: result.replace(/\s{2,}/g, ' ').trim(), directives }
}
