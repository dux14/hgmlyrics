/**
 * Huella de una sección para el diff de repintado: incluye SOLO los campos que
 * la hoja pinta. `words` se reduce a un booleano a propósito — la vista solo
 * necesita saber si el renglón tiene tiempos propios, y serializar el array
 * entero haría el diff más caro que el repintado que evita.
 */
export function sectionFingerprint(section) {
  return JSON.stringify([
    section.type ?? null,
    section.label ?? null,
    section.startMs ?? null,
    section.endMs ?? null,
    (section.lines ?? []).map((l) => [
      l.text ?? '',
      Boolean(l.vocalization),
      typeof l.confidence === 'number' ? l.confidence : null,
      l.startMs ?? null,
      l.endMs ?? null,
      Array.isArray(l.words) && l.words.length > 0,
    ]),
  ]);
}
