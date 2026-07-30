/**
 * structureShape.js — Forma de la estructura detectada, antes de armar el
 * documento de revisión. SongFormer sobre-segmenta (run 24-jul: 16 secciones
 * contra 7 reales, estribillos partidos en dos, `bridge` duplicado), así que
 * los segmentos adyacentes del mismo tipo lírico se fusionan. Dominio PURO:
 * sin sql, sin fetch, sin Date.now.
 */

// Mismo mapa que lyricsReview.js: 'silencio' no tiene equivalente y por eso
// no fusiona ni es fusionable. 'instrumental' SÍ es contenido válido de la
// canción (decisión de producto) y fusiona igual que los tipos líricos.
const LABEL_TO_TYPE = {
  intro: 'intro',
  verso: 'verse',
  coro: 'chorus',
  puente: 'bridge',
  'pre-coro': 'prechorus',
  outro: 'outro',
  instrumental: 'instrumental',
};

/**
 * Fusiona segmentos adyacentes cuyo tipo lírico mapeado coincide. El
 * fusionado toma el startMs del primero y el endMs del último.
 * @param {Array<{label:string,startMs:number,endMs:number}>} segments ya
 *   ordenados por startMs (ver _dispatch.js:204-208).
 * @returns {Array<{label:string,startMs:number,endMs:number}>}
 */
export function collapseSegments(segments) {
  const out = [];
  for (const seg of segments ?? []) {
    const prev = out[out.length - 1];
    const type = LABEL_TO_TYPE[seg.label];
    const prevType = prev ? LABEL_TO_TYPE[prev.label] : undefined;
    if (prev && type && type === prevType) {
      prev.endMs = seg.endMs;
      continue;
    }
    out.push({ label: seg.label, startMs: seg.startMs, endMs: seg.endMs });
  }
  return out;
}

/**
 * Fusiona secciones ADYACENTES del documento cuando todos sus renglones
 * alineados apuntan a la misma sección de la semilla. Compara pertenencia
 * real, no conteos de sección: una semilla incompleta o una repetición no
 * escrita romperían un colapso por conteo. Sin semilla, o con renglones sin
 * `seedSectionIdx`, no hace nada.
 * @param {{version:number, sections:Array}} doc
 * @param {Array<{dbIndex:number,sectionIdx:number}>} seed salida de seedIndex
 * @returns {{version:number, sections:Array}} documento nuevo
 */
export function collapseBySeed(doc, seed) {
  if (!seed || seed.length === 0) return doc;
  const sections = [];
  // Sección semilla de una sección del doc: única si TODOS sus renglones
  // alineados coinciden; null si hay mezcla o si ninguno está alineado.
  const seedOf = (section) => {
    const idxs = (section.lines ?? [])
      .map((l) => l.seedSectionIdx)
      .filter((v) => Number.isInteger(v));
    if (idxs.length === 0 || idxs.length !== (section.lines ?? []).length) return null;
    return idxs.every((v) => v === idxs[0]) ? idxs[0] : null;
  };
  for (const section of doc.sections) {
    const prev = sections[sections.length - 1];
    const mine = seedOf(section);
    if (prev && mine !== null && seedOf(prev) === mine) {
      prev.lines.push(...section.lines);
      prev.endMs = section.endMs;
      continue;
    }
    sections.push({ ...section, lines: [...(section.lines ?? [])] });
  }
  return { ...doc, sections };
}
