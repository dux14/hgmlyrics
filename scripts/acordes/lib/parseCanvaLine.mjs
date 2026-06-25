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
