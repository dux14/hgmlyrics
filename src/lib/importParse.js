/** Importa texto pegado → bloques de sección. Detecta [Coro]/[Verso 1] y acordes inline [Am]. */
export function parseImportText(text) {
  const blocks = [];
  const rawLines = text.split('\n');
  let current = null;
  let sectionCounter = 0;

  for (const rawLine of rawLines) {
    const sectionMatch = rawLine.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (current) blocks.push(current);
      const label = sectionMatch[1];
      current = {
        id: `section-imp-${sectionCounter++}-${Date.now()}`,
        type: guessType(label),
        label,
        lines: [],
      };
    } else if (rawLine.trim() === '') {
      if (current && current.lines.length > 0) {
        blocks.push(current);
        current = null;
      }
    } else {
      if (!current) {
        current = {
          id: `section-imp-${sectionCounter++}-${Date.now()}`,
          type: 'verse',
          label: `Verso ${sectionCounter}`,
          lines: [],
        };
      }
      const { text: cleanText, chords } = parseLineChords(rawLine);
      current.lines.push({
        id: `line-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: cleanText,
        groups: [],
        chords: chords || [],
        annotation: false,
      });
    }
  }
  if (current && current.lines.length > 0) blocks.push(current);
  return blocks;
}

/** Parse inline chords [Am]text [F]text → { text, chords }. */
export function parseLineChords(lineText) {
  const chords = [];
  let cleanText = '';
  const regex = /\[([A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?[0-9]?(?:\/[A-G][#b]?)?)\]/g;
  let lastEnd = 0;
  let match;
  while ((match = regex.exec(lineText)) !== null) {
    cleanText += lineText.slice(lastEnd, match.index);
    chords.push({ ch: match[1], pos: cleanText.length });
    lastEnd = match.index + match[0].length;
  }
  cleanText += lineText.slice(lastEnd);
  return { text: cleanText, chords: chords.length > 0 ? chords : undefined };
}

/** Etiqueta → tipo de sección. */
export function guessType(label) {
  const lower = label.toLowerCase();
  if (lower.includes('verso') || lower.includes('verse')) return 'verse';
  if (lower.includes('coro') || lower.includes('chorus')) return 'chorus';
  if (lower.includes('puente') || lower.includes('bridge')) return 'bridge';
  if (lower.includes('pre')) return 'prechorus';
  if (lower.includes('intro')) return 'intro';
  if (lower.includes('outro')) return 'outro';
  return 'verse';
}
