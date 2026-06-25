// scripts/acordes/lib/sections.mjs

/** Replica la heurística de etiquetas del importador (SongEditor.guessType), pero null si no reconoce. */
export function guessType(label) {
  const lower = (label || '').toLowerCase();
  if (lower.includes('verso') || lower.includes('verse')) return 'verse';
  if (lower.includes('pre')) return 'prechorus';
  if (lower.includes('coro') || lower.includes('chorus')) return 'chorus';
  if (lower.includes('puente') || lower.includes('bridge')) return 'bridge';
  if (lower.includes('intro')) return 'intro';
  if (lower.includes('outro')) return 'outro';
  return null;
}

/**
 * Clasifica secciones: etiqueta PDF → solo-acordes(intro) → repetición literal(chorus) → resto(verse+review).
 * @param {Array<{label?:string, lines:Array<{text:string, chords:Array}>}>} rawSections
 * @returns {Array<{label?:string, lines:Array, type:string, review:boolean}>}
 */
export function classifySections(rawSections) {
  const blockKey = (sec) =>
    sec.lines.map((l) => (l.text || '').trim().toLowerCase()).join('\n');
  const blocks = rawSections.map(blockKey);
  const counts = new Map();
  for (const b of blocks) counts.set(b, (counts.get(b) || 0) + 1);

  return rawSections.map((sec, i) => {
    const labelType = guessType(sec.label);
    if (labelType) return { ...sec, type: labelType, review: false };
    const onlyChords = sec.lines.every((l) => !(l.text || '').trim());
    if (onlyChords) return { ...sec, type: 'intro', review: false };
    if (blocks[i] && counts.get(blocks[i]) > 1) return { ...sec, type: 'chorus', review: false };
    return { ...sec, type: 'verse', review: true };
  });
}
