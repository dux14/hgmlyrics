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

/**
 * A qué línea del análisis corresponde un renglón. El índice canónico es el
 * candidato preferido, pero no alcanza: hay análisis en producción con el doble
 * de líneas que renglones (runs viejos en modo transcripción, que agrupaban por
 * pausa), y ahí el índice apunta a otro renglón. La condición de aceptación
 * siempre es la misma: que las sílabas reconstruyan el texto en pantalla.
 *
 * 1. Si la línea del índice canónico calza, se usa.
 * 2. Si no, gana la línea que calce más cercana al índice esperado (empate: la
 *    menor). Resuelve el desalineamiento y también el coro repetido.
 * 3. Si ninguna calza, null → el botón queda deshabilitado con su motivo.
 *
 * @param {string} text Texto del renglón en pantalla
 * @param {number} canonicalIndex Índice del renglón entre los que no son anotación
 * @param {Array<{syllables?:Array}>} analysisLines Líneas de la voz elegida
 * @returns {{mapped:Array, lineIndex:number, exact:boolean}|null}
 */
export function resolveLine(text, canonicalIndex, analysisLines) {
  const lines = Array.isArray(analysisLines) ? analysisLines : [];
  if (typeof text !== 'string' || text === '' || lines.length === 0) return null;

  const at = (idx) => {
    const line = lines[idx];
    if (!line) return null;
    const mapped = mapSyllablesToChars(text, line.syllables);
    // Un mapeo vacío (línea del análisis sin sílabas) es truthy pero no calza
    // con nada: si se aceptara, ganaría el peldaño 1 contra cualquier texto.
    return mapped && mapped.length > 0 ? mapped : null;
  };

  const exactMapped = Number.isInteger(canonicalIndex) ? at(canonicalIndex) : null;
  if (exactMapped) return { mapped: exactMapped, lineIndex: canonicalIndex, exact: true };

  const target = Number.isInteger(canonicalIndex) ? canonicalIndex : 0;
  let best = null;
  lines.forEach((_line, idx) => {
    const mapped = at(idx);
    if (!mapped) return;
    const distance = Math.abs(idx - target);
    if (best === null || distance < best.distance) best = { mapped, lineIndex: idx, distance };
  });

  if (best === null) return null;
  return { mapped: best.mapped, lineIndex: best.lineIndex, exact: false };
}

/**
 * Índice de un renglón entre los que no son anotación, en orden de documento.
 * Replica la regla de `projectCanonicalLines` (api/_lib/align.js) y de
 * `projectLines` (src/lib/projectLines.js): las anotaciones no cuentan, los
 * renglones vacíos sí, y una sección sin `lines` no aporta ninguno.
 * @param {Array<{lines?:Array<{id?:string, annotation?:boolean}>}>} blocks
 * @param {string} lineId
 * @returns {number} -1 si el renglón no existe o es una anotación
 */
export function canonicalLineIndex(blocks, lineId) {
  let index = 0;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const line of Array.isArray(block?.lines) ? block.lines : []) {
      if (line.annotation) continue;
      if (line.id === lineId) return index;
      index += 1;
    }
  }
  return -1;
}
