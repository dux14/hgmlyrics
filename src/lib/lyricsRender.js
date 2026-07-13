/**
 * lyricsRender.js — Builders puros de HTML por modo de lectura (Letra/Acordes/Tono).
 *
 * Componen los primitivos del modelo v3 de voiceSystem.js (buildAnnotatedLineHTML,
 * groupsForVoice) en HTML listo para el lector y para la vista previa del editor.
 * Sin DOM → testeable como string.
 */
import { buildAnnotatedLineHTML, groupsForVoice } from './voiceSystem.js';
import { escapeHtml as esc } from './escape.js';
import { displayChord, displayNote, parseChordRoot } from './chordNotation.js';

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
  const parsed = parseChordRoot(chord);
  if (!parsed) return chord;
  const root = parsed.root + parsed.accidental;
  const normalized = NORMALIZE[root] || root;
  const idx = NOTES_SHARP.indexOf(normalized);
  if (idx === -1) return chord;
  const newIdx = (((idx + semitones) % 12) + 12) % 12;
  return (useFlats ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx]) + parsed.rest;
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

const KEY_RE = /^([A-G][#b]?)\s+(major|minor)$/i;

/**
 * Transpone el tono de una canción (formato "G major"/"D minor", constraint
 * de la columna `songs.key`) a un símbolo de acorde anglo por semitonos, listo
 * para `displayChord`. Entrada inválida/vacía → null (canción sin tono).
 * @param {string} key
 * @param {number} [semitones]
 * @param {boolean} [useFlats]
 * @returns {string|null}
 */
export function transposeKey(key, semitones = 0, useFlats = false) {
  const m = KEY_RE.exec(String(key || '').trim());
  if (!m) return null;
  const symbol = m[2].toLowerCase() === 'minor' ? `${m[1]}m` : m[1];
  return semitones ? transposeChord(symbol, semitones, useFlats) : symbol;
}

/**
 * Etiqueta del bubble de tono (T3): "Sol · Original" / "La · +2" con key;
 * "0 · Original" / "+2" sin key (la canción no tiene tono asignado).
 * @param {string} key
 * @param {number} semitones
 * @param {boolean} useFlats
 * @param {'anglo'|'latin'} notation
 * @returns {string}
 */
export function buildTransposeBubbleLabel(key, semitones, useFlats, notation) {
  const sign = semitones > 0 ? '+' : semitones < 0 ? '−' : '';
  const deviation = semitones === 0 ? 'Original' : `${sign}${Math.abs(semitones)}`;
  const transposedSymbol = transposeKey(key, semitones, useFlats);
  if (!transposedSymbol) return semitones === 0 ? `0 · ${deviation}` : deviation;
  return `${displayChord(transposedSymbol, notation)} · ${deviation}`;
}

/**
 * Hint de cejilla (T3): "Cejilla {n} · suena en {tono real}" cuando hay key
 * (la cejilla SUBE el tono sonante: +n semitonos sobre el tono original).
 * Sin key, cae al texto plano previo.
 * @param {string} key
 * @param {number} cejilla
 * @param {boolean} useFlats
 * @param {'anglo'|'latin'} notation
 * @returns {string}
 */
export function buildCejillaHint(key, cejilla, useFlats, notation) {
  const symbol = transposeKey(key, cejilla, useFlats);
  if (!symbol) return `Cejilla: ${cejilla}`;
  return `Cejilla ${cejilla} · suena en ${displayChord(symbol, notation)}`;
}

/**
 * Modo Acordes (GA): letra atenuada (~55%) + acordes flotantes anclados a su
 * carácter (no parten palabras). `pos` se clampa a [0, len].
 * @param {string} text
 * @param {Array<{pos:number,ch:string}>} chords
 * @param {{ transposeSemitones?:number, useFlats?:boolean, notation?:'anglo'|'latin' }} [opts]
 * @returns {string} HTML
 */
export function buildChordsLineHTML(text, chords, opts = {}) {
  const str = text || '';
  const len = str.length;
  const transposeSemitones = opts.transposeSemitones || 0;
  const useFlats = !!opts.useFlats;
  const notation = opts.notation || 'anglo';
  const labels = (Array.isArray(chords) ? chords : []).map((c) => {
    const ch = transposeSemitones !== 0 ? transposeChord(c.ch, transposeSemitones, useFlats) : c.ch;
    return {
      pos: Math.min(Math.max(c.pos || 0, 0), len),
      text: displayChord(ch, notation),
      className: 'chord-label',
    };
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
 * @param {{ notation?: 'anglo'|'latin' }} [opts]
 * @returns {string} HTML
 */
export function buildTonoLineHTML(line, voiceId, colorClass, opts = {}) {
  const text = line?.text || '';
  const groups = groupsForVoice(line, voiceId);
  const cls = colorClass || '';
  const notation = opts.notation || 'anglo';
  // Semántica Wave 4: el color vive en la palabra mientras el grupo no tiene
  // nota; cuando la nota existe, el color se muda a ella y la palabra va blanca.
  const spans = groups.map((g) => ({
    start: g.start,
    end: g.end,
    className: hasNote(g) ? 'lyrics__tono-sung' : `lyrics__tono-pending ${cls}`.trim(),
  }));
  const labels = groups.filter(hasNote).map((g) => ({
    pos: g.start,
    text: displayNote(g.note, notation),
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
 * @param {{ transposeSemitones?: number, useFlats?: boolean, notation?:'anglo'|'latin' }} [opts]
 * @returns {string} HTML
 */
export function buildMixedLineHTML(line, chords, voiceId, colorClass, opts = {}) {
  const text = line?.text || '';
  const len = text.length;
  const semis = opts.transposeSemitones || 0;
  const useFlats = !!opts.useFlats;
  const notation = opts.notation || 'anglo';
  const cls = colorClass || '';
  const groups = groupsForVoice(line, voiceId);

  const chordByPos = new Map();
  for (const c of Array.isArray(chords) ? chords : []) {
    const pos = Math.min(Math.max(c.pos || 0, 0), len);
    if (!chordByPos.has(pos)) {
      const ch = semis !== 0 ? transposeChord(c.ch, semis, useFlats) : c.ch;
      chordByPos.set(pos, displayChord(ch, notation));
    }
  }
  const noteByPos = new Map();
  for (const g of groups) {
    if (g.start < g.end && hasNote(g) && !noteByPos.has(g.start)) {
      const note = semis !== 0 ? transposeNote(g.note, semis, useFlats) : g.note;
      noteByPos.set(g.start, displayNote(note, notation));
    }
  }

  const cuts = new Set([0, len]);
  for (const p of chordByPos.keys()) cuts.add(p);
  for (const g of groups) {
    if (g.start >= 0 && g.start <= len) cuts.add(g.start);
    if (g.end >= 0 && g.end <= len) cuts.add(g.end);
  }
  // Corta también en los límites espacio/no-espacio: una palabra (run sin
  // espacios) es la unidad de wrap; nunca se parte entre renglones.
  for (let i = 1; i < len; i++) {
    if (/\s/.test(text[i - 1]) !== /\s/.test(text[i])) cuts.add(i);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const seg = (chord, lyricCls, slice, note) =>
    `<span class="mix-seg">` +
    `<span class="mix-rail mix-rail--chord">${chord ? `<i>${esc(chord)}</i>` : ''}</span>` +
    `<span class="mix-rail mix-rail--lyric ${lyricCls}">${esc(slice)}</span>` +
    `<span class="mix-rail mix-rail--note${cls ? ` ${cls}` : ''}">${note ? `<i>${esc(note)}</i>` : ''}</span>` +
    `</span>`;

  let html = '';
  let wordBuf = ''; // acumula los .mix-seg de la palabra en curso antes de volcarlos
  const flushWord = () => {
    if (!wordBuf) return;
    html += `<span class="line-word">${wordBuf}</span>`;
    wordBuf = '';
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a >= b) continue;
    const slice = text.slice(a, b);
    const hasAnchor = chordByPos.has(a) || noteByPos.has(a);
    const isSpaceSlice = /^\s+$/.test(slice);
    // Slice solo-espacios sin acorde/nota anclados en su inicio → texto plano
    // fuera de cualquier wrapper (abre oportunidad de wrap entre palabras).
    if (isSpaceSlice && !hasAnchor) {
      flushWord();
      html += esc(slice);
      continue;
    }
    const group = groups.find((g) => g.start <= a && g.end >= b && g.start < g.end);
    let lyricCls = 'lyrics__tono-dim';
    if (group) {
      lyricCls = hasNote(group) ? 'lyrics__tono-sung' : `lyrics__tono-pending ${cls}`.trim();
    }
    const segHtml = seg(chordByPos.get(a), lyricCls, slice, noteByPos.get(a));
    if (isSpaceSlice) {
      // Ancla cayó exactamente sobre un espacio (caso borde, p.ej. columnas
      // de ChordPro alineadas al espacio entre palabras): el espacio SIGUE
      // siendo punto de corte de línea válido, así que el .mix-seg va suelto
      // — flushea la palabra previa ANTES y arranca una nueva después, para
      // no fusionar las dos palabras vecinas en un .line-word inquebrantable.
      flushWord();
      html += segHtml;
    } else {
      wordBuf += segHtml;
    }
  }
  flushWord();
  // noteByPos.has(len) es defensivo — el esquema v3 impide g.start === len
  if (chordByPos.has(len) || noteByPos.has(len)) {
    html += seg(chordByPos.get(len), 'lyrics__tono-dim', '', noteByPos.get(len));
  }
  return html;
}
