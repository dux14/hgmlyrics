// scripts/acordes/lib/extractCanva.mjs
// Extracción del HTML de Canva (capa opacity:0) → canciones con líneas.

export function splitSections(html) {
  return html.match(/<section\b[\s\S]*?<\/section>/g) ?? []
}

export function sectionLines(section) {
  // La capa de texto accesible va en <p>/<br>; el orden del DOM = orden de lectura.
  const withBreaks = section.replace(/<br\s*\/?>/gi, '\n')
  const stripped = withBreaks.replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&')
  return stripped.split('\n').map(l => l.replace(/\s+$/g, '')).filter(l => l.trim())
}

const EMOJI = /\p{Extended_Pictographic}(\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*/gu
const NOT_SONG = /^(carpeta|canciones|planes|completa|por montar|base (mujeres|hombres))\b/i

export function detectSongTitle(lines) {
  const first = (lines[0] ?? '').trim()
  const name = first.replace(EMOJI, '').trim()
  // No-canción: sin emoji inicial, carpetas/headers, vacío, o sólo emoji (sin texto alfabético)
  const hasLeadingEmoji = /^\p{Extended_Pictographic}/u.test(first)
  const isSong = hasLeadingEmoji && name.length > 1 && !NOT_SONG.test(name) && /\p{L}/u.test(name)
  return { title: name, isSong }
}

const ARRANGEMENT = /^(base|completa|segundas|primeras|solo|coro|voz)\b/i

export function splitArrangementPreamble(body) {
  const preamble = []
  let i = 0
  // El preámbulo son notas de arreglo de texto antes del primer emoji/marcador/letra
  while (i < body.length && ARRANGEMENT.test(body[i].trim()) && !/\p{Extended_Pictographic}/u.test(body[i])) {
    preamble.push(body[i].trim())
    i++
  }
  return { preamble, body: body.slice(i) }
}

const GLOSS = /^\s*(\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}]*)\s*(?:\d+\s*)?(?:->|-&gt;|→)?\s*(.+?)\s*$/u

export function splitEmojiGlossary(lines) {
  const glossary = {}
  let end = lines.length
  // El glosario es un bloque contiguo al final: líneas que empiezan por emoji + descripción
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(GLOSS)
    const startsEmoji = /^\s*\p{Extended_Pictographic}/u.test(lines[i])
    if (startsEmoji && m && /->|-&gt;|→|\(|guitarra|piano|ukelele|trompeta|disco|base/iu.test(lines[i])) {
      glossary[m[1]] = m[2].replace(/^->\s*|-&gt;\s*/,'').trim()
      end = i
    } else break
  }
  return { body: lines.slice(0, end), glossary }
}

export function joinContinuations(sectionsLines) {
  const songs = []
  for (const lines of sectionsLines) {
    const { title, isSong } = detectSongTitle(lines)
    if (isSong) songs.push({ title, lines: [...lines] })
    else if (songs.length) songs[songs.length - 1].lines.push(...lines) // continuación
    // si no hay canción previa (separador inicial) se descarta
  }
  return songs
}
