// scripts/acordes/lib/pair.mjs
import { isChordLine, isChord, xToCharIndex } from './chords.mjs';

/**
 * Empareja cada línea de letra con la línea de acordes ~deltaY ENCIMA (y mayor)
 * y posiciona cada acorde por su x. Líneas de acordes sin letra debajo se descartan.
 * @param {Array<{y:number,items:Array,text:string}>} lines  (orden arriba→abajo)
 * @param {number} deltaY
 * @param {number} yTol
 * @returns {Array<{text:string, chords:Array<{pos:number,ch:string}>}>}
 */
export function pairChordLines(lines, deltaY = 14, yTol = 4) {
  const chordLines = lines.filter(isChordLine);
  const lyricLines = lines.filter((l) => !isChordLine(l));
  const used = new Set();
  const result = [];
  for (const lyric of lyricLines) {
    const above = chordLines.find(
      (c) => !used.has(c) && Math.abs(c.y - (lyric.y + deltaY)) <= yTol
    );
    const chords = [];
    if (above) {
      used.add(above);
      for (const it of above.items) {
        if (!isChord(it.str)) continue;
        chords.push({ pos: xToCharIndex(it.x, lyric), ch: (it.str || '').trim() });
      }
      chords.sort((a, b) => a.pos - b.pos);
    }
    result.push({ text: lyric.text, chords });
  }
  return result;
}
