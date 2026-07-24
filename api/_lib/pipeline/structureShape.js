/**
 * structureShape.js — Forma de la estructura detectada, antes de armar el
 * documento de revisión. SongFormer sobre-segmenta (run 24-jul: 16 secciones
 * contra 7 reales, estribillos partidos en dos, `bridge` duplicado), así que
 * los segmentos adyacentes del mismo tipo lírico se fusionan. Dominio PURO:
 * sin sql, sin fetch, sin Date.now.
 */

// Mismo mapa que lyricsReview.js: 'instrumental'/'silencio' no tienen
// equivalente lírico y por eso no fusionan ni son fusionables.
const LABEL_TO_TYPE = {
  intro: 'intro',
  verso: 'verse',
  coro: 'chorus',
  puente: 'bridge',
  'pre-coro': 'prechorus',
  outro: 'outro',
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
