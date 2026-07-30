/**
 * pitchSyllableMap.js — Cruza las sílabas con nota del análisis de tono
 * (song_pitch_analysis, vía /api/songs/[id]/pitch-notes) con el texto de un
 * renglón del cancionero, para la acción «traer el tono de la IA» del editor.
 *
 * Módulo PURO: sin DOM y sin fetch. El mapeo corre contra el texto EN PANTALLA
 * (que puede estar editado y sin guardar), no contra el de la base: por eso los
 * offsets de carácter se calculan acá y no en el backend.
 */
import { midiToName } from './notes.js';
import { isValidNote } from './voiceSystem.js';

// Caracteres que pueden aparecer en el texto sin pertenecer a ninguna sílaba
// (espacios y puntuación): la silabificación los deja pegados a la sílaba
// anterior o los omite. Cualquier cosa que no sea letra ni número.
const SEPARATOR_RE = /[^\p{L}\p{N}]/u;
const CONTENT_RE = /[\p{L}\p{N}]/u;

/**
 * Nombre de nota de una sílaba del análisis. `note` propia si viene; si es una
 * repetición (`ditto`: note null con midi presente) se deriva del midi. Una
 * nota fuera de las octavas que acepta el editor se trata como sin nota, para
 * que no la rechace la validación al agregar el grupo.
 * @param {{note?:string|null, midi?:number|null}} syl
 * @returns {{note:string|null, midi:number|null}}
 */
function resolveNote(syl) {
  const midi = Number.isFinite(syl?.midi) ? Math.round(syl.midi) : null;
  if (midi === null) return { note: null, midi: null };
  const name = typeof syl.note === 'string' && syl.note !== '' ? syl.note : midiToName(midi);
  if (!isValidNote(name)) return { note: null, midi: null };
  return { note: name, midi };
}

/**
 * Mapea las sílabas del análisis a rangos de carácter sobre `text`. Avanza con
 * un cursor, saltando separadores, y exige coincidencia EXACTA de caracteres:
 * si el renglón se editó desde el run, devuelve null en vez de una posición
 * corrida (una nota en el carácter equivocado es peor que ninguna nota).
 * @param {string} text Texto del renglón tal como está en pantalla
 * @param {Array<{text?:string, note?:string|null, midi?:number|null}>} syllables
 * @returns {Array<{charStart:number, charEnd:number, note:string|null, midi:number|null}>|null}
 */
export function mapSyllablesToChars(text, syllables) {
  const src = typeof text === 'string' ? text : '';
  const list = Array.isArray(syllables) ? syllables : [];
  if (list.length === 0) return [];
  const out = [];
  let cursor = 0;

  for (const syl of list) {
    const piece = typeof syl?.text === 'string' ? syl.text : '';
    const { note, midi } = resolveNote(syl);

    // Extensor de melisma: no consume caracteres, marca la posición actual.
    if (piece === '') {
      out.push({ charStart: cursor, charEnd: cursor, note, midi });
      continue;
    }

    while (cursor < src.length && src[cursor] !== piece[0] && SEPARATOR_RE.test(src[cursor])) {
      cursor += 1;
    }
    if (src.slice(cursor, cursor + piece.length) !== piece) return null;

    out.push({ charStart: cursor, charEnd: cursor + piece.length, note, midi });
    cursor += piece.length;
  }

  // Texto de sobra con letras o números: el renglón dice más que el análisis.
  if (CONTENT_RE.test(src.slice(cursor))) return null;

  return out;
}

/**
 * Nota que corresponde a un rango de caracteres, y la secuencia de notas que el
 * rango contiene (para el aviso cuando hay más de una). El grupo lleva UNA
 * nota: se usa la de la primera sílaba con nota, que es lo predecible.
 * Las sílabas de ancho cero (melisma) cuentan si su posición cae en el rango.
 * @param {Array<{charStart:number, charEnd:number, note:string|null}>|null} mapped
 * @param {{start:number, end:number}|null} range
 * @returns {{note:string|null, notes:string[]}}
 */
export function noteForRange(mapped, range) {
  const list = Array.isArray(mapped) ? mapped : [];
  const start = Number.isFinite(range?.start) ? range.start : null;
  const end = Number.isFinite(range?.end) ? range.end : null;
  if (start === null || end === null) return { note: null, notes: [] };

  const notes = [];
  for (const syl of list) {
    const touches =
      syl.charStart === syl.charEnd
        ? syl.charStart >= start && syl.charStart <= end
        : syl.charStart < end && syl.charEnd > start;
    if (!touches || syl.note === null) continue;
    // Sin duplicados consecutivos: el aviso dice «B3 C4», no «B3 B3 C4».
    if (notes[notes.length - 1] !== syl.note) notes.push(syl.note);
  }

  return { note: notes[0] ?? null, notes };
}
