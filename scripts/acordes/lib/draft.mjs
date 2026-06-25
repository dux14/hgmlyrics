// scripts/acordes/lib/draft.mjs
import { isInlineableChord } from './chords.mjs';

const TYPE_LABELS = {
  verse: 'Verso',
  chorus: 'Coro',
  bridge: 'Puente',
  prechorus: 'Pre-Coro',
  intro: 'Intro',
  outro: 'Outro',
};

/**
 * Inserta [ch] antes de cada pos (descendente para preservar índices).
 * Omite acordes no inlineables y los devuelve en `skipped`.
 * @returns {{line:string, skipped:Array<{pos:number,ch:string}>}}
 */
export function insertInlineChords(text, chords) {
  const skipped = [];
  const usable = [];
  for (const c of chords || []) {
    if (isInlineableChord(c.ch)) usable.push(c);
    else skipped.push(c);
  }
  let line = text || '';
  for (const c of [...usable].sort((a, b) => b.pos - a.pos)) {
    const p = Math.max(0, Math.min(line.length, c.pos));
    line = line.slice(0, p) + `[${c.ch}]` + line.slice(p);
  }
  return { line, skipped };
}

/**
 * Modelo de canción → texto en formato del importador (`[Coro]` + `[Am]inline`).
 * @returns {{text:string, skipped:Array<{section:number,pos:number,ch:string}>}}
 */
export function emitDraftText(song) {
  const out = [];
  const skipped = [];
  let verseNo = 0;
  (song.sections || []).forEach((sec, si) => {
    let label = TYPE_LABELS[sec.type] || 'Verso';
    if (sec.type === 'verse') label = `Verso ${++verseNo}`;
    out.push(`[${label}]`);
    for (const l of sec.lines || []) {
      const { line, skipped: sk } = insertInlineChords(l.text || '', l.chords || []);
      out.push(line);
      for (const c of sk) skipped.push({ section: si, ...c });
    }
    out.push('');
  });
  return { text: out.join('\n').trimEnd() + '\n', skipped };
}
