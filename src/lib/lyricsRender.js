/**
 * lyricsRender.js — Builders puros de HTML por modo de lectura (Letra/Acordes/Tono).
 *
 * Componen los primitivos del modelo v3 de voiceSystem.js (buildAnnotatedLineHTML,
 * groupsForVoice) en HTML listo para el lector y para la vista previa del editor.
 * Sin DOM → testeable como string.
 */
import { buildAnnotatedLineHTML } from './voiceSystem.js';

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
