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
