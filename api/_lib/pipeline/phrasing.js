// Regla de fraseo (spec, decision 11): renglon = frase cantable de un aire.
// Con timestamps por palabra, un gap de respiracion dentro del renglon
// sugiere dividirlo. Puro, sin I/O.

export const BREATH_GAP_MS = 350;
const MIN_WORDS_PER_SIDE = 2;

export function suggestLineBreaks(words, gapMs = BREATH_GAP_MS) {
  const breaks = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    const gap = words[i + 1].startMs - words[i].endMs;
    if (gap < gapMs) continue;
    const left = i + 1;
    const right = words.length - left;
    if (left < MIN_WORDS_PER_SIDE || right < MIN_WORDS_PER_SIDE) continue;
    breaks.push(i);
  }
  return breaks;
}
