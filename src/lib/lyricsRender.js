/**
 * lyricsRender.js — Builders puros de HTML por modo de lectura (Letra/Acordes/Tono).
 *
 * Componen los primitivos del modelo v3 de voiceSystem.js (buildAnnotatedLineHTML,
 * groupsForVoice) en HTML listo para el lector y para la vista previa del editor.
 * Sin DOM → testeable como string.
 */
import { buildAnnotatedLineHTML, groupsForVoice } from './voiceSystem.js';
import { escapeHtml as esc } from './escape.js';

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
  // Cb cruza la octava hacia abajo al normalizar (Cb4 ≡ B3, no B4).
  const enharmonicShift = m[1] === 'Cb' ? -1 : 0;
  const total = idx + semitones;
  const newIdx = ((total % 12) + 12) % 12;
  const octave = Number.parseInt(m[2], 10) + Math.floor(total / 12) + enharmonicShift;
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

// Predicado único: nota presente y no-vacía. Usado por buildTonoLineHTML y
// buildMixedLineHTML para detectar si un grupo tiene nota asignada.
const hasNote = (g) => g.note !== null && g.note !== undefined && g.note !== '';

/**
 * Escapa caracteres HTML especiales para uso seguro en strings de HTML.
 * @param {string|null|undefined} str
 * @returns {string}
 */

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
  // Semántica Wave 4: el color vive en la palabra mientras el grupo no tiene
  // nota; cuando la nota existe, el color se muda a ella y la palabra va blanca.
  const spans = groups.map((g) => ({
    start: g.start,
    end: g.end,
    className: hasNote(g) ? 'lyrics__tono-sung' : `lyrics__tono-pending ${cls}`.trim(),
  }));
  const labels = groups.filter(hasNote).map((g) => ({
    pos: g.start,
    text: g.note,
    className: cls ? `${cls} tono-note` : 'tono-note',
  }));
  return buildAnnotatedLineHTML(text, { spans, labels, baseClass: 'lyrics__tono-dim' });
}

/**
 * Vista combinada (flag voz_tono): letra + acordes + tono de UNA voz en una
 * línea de 3 rieles ESTRICTOS de altura fija — acorde arriba / letra al medio /
 * nota abajo. Todo run de texto (incluido lo no cantado, comas, guiones) vive
 * en el riel de letra; los rieles existen en todos los segmentos para que nada
 * "caiga" de carril. Transposición mueve acordes y notas juntos.
 * @param {object} line línea v3 con {text, groups}
 * @param {Array<{pos:number,ch:string}>} chords
 * @param {string} voiceId voz activa (roster)
 * @param {string} colorClass p.ej. 'voice-text--tenor'
 * @param {{ transposeSemitones?: number, useFlats?: boolean }} [opts]
 * @returns {string} HTML
 */
export function buildMixedLineHTML(line, chords, voiceId, colorClass, opts = {}) {
  const text = line?.text || '';
  const len = text.length;
  const semis = opts.transposeSemitones || 0;
  const useFlats = !!opts.useFlats;
  const cls = colorClass || '';
  const groups = groupsForVoice(line, voiceId);

  const chordByPos = new Map();
  for (const c of Array.isArray(chords) ? chords : []) {
    const pos = Math.min(Math.max(c.pos || 0, 0), len);
    if (!chordByPos.has(pos)) {
      chordByPos.set(pos, semis !== 0 ? transposeChord(c.ch, semis, useFlats) : c.ch);
    }
  }
  const noteByPos = new Map();
  for (const g of groups) {
    if (g.start < g.end && hasNote(g) && !noteByPos.has(g.start)) {
      noteByPos.set(g.start, semis !== 0 ? transposeNote(g.note, semis, useFlats) : g.note);
    }
  }

  const cuts = new Set([0, len]);
  for (const p of chordByPos.keys()) cuts.add(p);
  for (const g of groups) {
    if (g.start >= 0 && g.start <= len) cuts.add(g.start);
    if (g.end >= 0 && g.end <= len) cuts.add(g.end);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const seg = (chord, lyricCls, slice, note) =>
    `<span class="mix-seg">` +
    `<span class="mix-rail mix-rail--chord">${chord ? `<i>${esc(chord)}</i>` : ''}</span>` +
    `<span class="mix-rail mix-rail--lyric ${lyricCls}">${esc(slice)}</span>` +
    `<span class="mix-rail mix-rail--note${cls ? ` ${cls}` : ''}">${note ? `<i>${esc(note)}</i>` : ''}</span>` +
    `</span>`;

  let html = '';
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a >= b) continue;
    const group = groups.find((g) => g.start <= a && g.end >= b && g.start < g.end);
    let lyricCls = 'lyrics__tono-dim';
    if (group) {
      lyricCls = hasNote(group) ? 'lyrics__tono-sung' : `lyrics__tono-pending ${cls}`.trim();
    }
    html += seg(chordByPos.get(a), lyricCls, text.slice(a, b), noteByPos.get(a));
  }
  // noteByPos.has(len) es defensivo — el esquema v3 impide g.start === len
  if (chordByPos.has(len) || noteByPos.has(len)) {
    html += seg(chordByPos.get(len), 'lyrics__tono-dim', '', noteByPos.get(len));
  }
  return html;
}
