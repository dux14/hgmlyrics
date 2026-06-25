const MAP = {
  TODOS: ['soprano','contralto','tenor','bass'], CORO: ['soprano','contralto','tenor','bass'],
  VOCES: ['soprano','contralto','tenor','bass'],
  HOMBRES: ['tenor','bass'], MUJERES: ['soprano','contralto'],
  ALTAS: ['soprano'], BAJAS: ['contralto'], ALTOS: ['tenor'], BAJOS: ['bass'],
  SOLO: ['tenor'], SOLISTA: ['tenor'], // categoría "Solista" configurable; default tenor
}
const TOKEN = /\b(TODOS|CORO|VOCES|HOMBRES|MUJERES|ALTAS|BAJAS|ALTOS|BAJOS|SOLISTA|SOLO)\b/g

export function expandVoices(label) {
  const tokens = label.toUpperCase().match(TOKEN)
  if (!tokens) return null
  const out = []
  for (const t of tokens) for (const v of MAP[t]) if (!out.includes(v)) out.push(v)
  return out.length ? out : null
}
