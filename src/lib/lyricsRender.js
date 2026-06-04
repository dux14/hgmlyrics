/**
 * lyricsRender.js — Builders puros de HTML por modo de lectura (Letra/Acordes/Tono).
 *
 * Componen los primitivos del modelo v3 de voiceSystem.js (buildAnnotatedLineHTML,
 * groupsForVoice) en HTML listo para el lector y para la vista previa del editor.
 * Sin DOM → testeable como string.
 */
import { buildAnnotatedLineHTML, groupsForVoice } from './voiceSystem.js';

/**
 * Modo Letra (GA): texto blanco plano, escapado, sin etiquetas ni color.
 * @param {string} text
 * @returns {string} HTML
 */
export function buildLetraLineHTML(text) {
  return buildAnnotatedLineHTML(text || '', {});
}

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NORMALIZE = { Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B' };

/**
 * Transpone un acorde por semitonos, conservando su sufijo (m7, sus4, …).
 * @param {string} chord @param {number} semitones @param {boolean} useFlats
 * @returns {string}
 */
export function transposeChord(chord, semitones, useFlats) {
  return chord.replace(/^([A-G][#b]?)/, (_, root) => {
    const normalized = NORMALIZE[root] || root;
    const idx = NOTES_SHARP.indexOf(normalized);
    if (idx === -1) return root;
    const newIdx = (((idx + semitones) % 12) + 12) % 12;
    return useFlats ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx];
  });
}

/**
 * Transpone una nota en notación científica (p.ej. "B3") por semitonos,
 * con manejo de octava (B3 +1 → C4). Entrada inválida pasa intacta.
 * @param {string} note @param {number} semitones @param {boolean} [useFlats]
 * @returns {string}
 */
export function transposeNote(note, semitones, useFlats = false) {
  const m = /^([A-G][#b]?)(-?\d+)$/.exec(String(note || '').trim());
  if (!m) return note;
  const root = NORMALIZE[m[1]] || m[1];
  const idx = NOTES_SHARP.indexOf(root);
  if (idx === -1) return note;
  const total = idx + semitones;
  const newIdx = ((total % 12) + 12) % 12;
  const octave = Number.parseInt(m[2], 10) + Math.floor(total / 12);
  return `${useFlats ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx]}${octave}`;
}

/**
 * Modo Acordes (GA): letra atenuada (~55%) + acordes flotantes anclados a su
 * carácter (no parten palabras). `pos` se clampa a [0, len].
 * @param {string} text
 * @param {Array<{pos:number,ch:string}>} chords
 * @param {{ transposeSemitones?:number, useFlats?:boolean }} [opts]
 * @returns {string} HTML
 */
export function buildChordsLineHTML(text, chords, opts = {}) {
  const str = text || '';
  const len = str.length;
  const transposeSemitones = opts.transposeSemitones || 0;
  const useFlats = !!opts.useFlats;
  const labels = (Array.isArray(chords) ? chords : []).map((c) => {
    const ch = transposeSemitones !== 0 ? transposeChord(c.ch, transposeSemitones, useFlats) : c.ch;
    return { pos: Math.min(Math.max(c.pos || 0, 0), len), text: ch, className: 'chord-label' };
  });
  return buildAnnotatedLineHTML(str, { labels, baseClass: 'lyrics__letra-dim' });
}

/**
 * Modo Tono (flag voz_tono): la letra cantada por la voz activa va neutra
 * (clase `lyrics__tono-sung`, legible) y su NOTA flota sobre cada grupo con el
 * color de la voz (`colorClass`) para que resalte; el resto del texto se atenúa.
 *
 * Wave 4 — estado "pending": cuando un grupo NO tiene nota asignada, el color
 * de la voz vive en la PALABRA misma (clase `lyrics__tono-pending` + colorClass)
 * y no se genera etiqueta flotante. Cuando la nota existe el color se muda a
 * ella y la palabra va blanca (`lyrics__tono-sung`).
 *
 * Mismo esquema para las 4 voces.
 * @param {object} line  línea v3 con {text, groups}
 * @param {string} voiceId  id de la voz activa (roster)
 * @param {string} colorClass  clase de color de categoría, p.ej. 'voice-text--soprano'
 * @returns {string} HTML
 */
export function buildTonoLineHTML(line, voiceId, colorClass) {
  const text = line?.text || '';
  const groups = groupsForVoice(line, voiceId);
  const cls = colorClass || '';
  // Predicado único: nota presente y no-vacía.
  const hasNote = (g) => g.note !== null && g.note !== undefined && g.note !== '';
  // Semántica Wave 4: el color vive en la palabra mientras el grupo no tiene
  // nota; cuando la nota existe, el color se muda a ella y la palabra va blanca.
  const spans = groups.map((g) => ({
    start: g.start,
    end: g.end,
    className: hasNote(g) ? 'lyrics__tono-sung' : `lyrics__tono-pending ${cls}`.trim(),
  }));
  const labels = groups
    .filter(hasNote)
    .map((g) => ({ pos: g.start, text: g.note, className: `${cls} tono-note` }));
  return buildAnnotatedLineHTML(text, { spans, labels, baseClass: 'lyrics__tono-dim' });
}
