/**
 * notes.js — Scientific pitch notation helpers.
 *
 * - Reference: A4 = 440 Hz, MIDI 69.
 * - Note names use sharps only (canonical with `musicKeys.js`).
 * - All helpers are pure and synchronous; safe in any environment.
 */

import { MUSICAL_KEYS } from './musicKeys.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAME_TO_SEMITONE = Object.fromEntries(NOTE_NAMES.map((n, i) => [n, i]));
// Enharmonic flats — accepted as input but normalized to sharps.
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

// Major: W W H W W W H = 2 2 1 2 2 2 1
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
// Natural minor: W H W W H W W = 2 1 2 2 1 2 2
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

/**
 * Parse a note string like "A4", "F#3", "Bb5" into {name, octave}.
 * Throws on invalid input.
 * @param {string} noteStr
 * @returns {{name: string, octave: number}}
 */
function parseNote(noteStr) {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(String(noteStr).trim());
  if (!m) throw new Error(`Invalid note: ${noteStr}`);
  let name = m[2] ? m[1] + m[2] : m[1];
  if (FLAT_TO_SHARP[name]) name = FLAT_TO_SHARP[name];
  if (!(name in NAME_TO_SEMITONE)) throw new Error(`Invalid note: ${noteStr}`);
  return { name, octave: Number.parseInt(m[3], 10) };
}

/**
 * Convert a scientific-pitch note ("A4", "F#3") to a MIDI number.
 * MIDI 69 = A4. Each octave is 12 semitones; C is the first note of an octave.
 * @param {string} noteStr
 * @returns {number}
 */
export function noteToMidi(noteStr) {
  const { name, octave } = parseNote(noteStr);
  return (octave + 1) * 12 + NAME_TO_SEMITONE[name];
}

/**
 * Convert a note string to its frequency in Hz.
 * @param {string} noteStr e.g. "A4", "C3", "F#2"
 * @returns {number} Frequency in Hz.
 */
export function noteToFrequency(noteStr) {
  const midi = noteToMidi(noteStr);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Convert a frequency in Hz to the closest note, octave, and cents offset.
 * @param {number} hz
 * @returns {{ note: string, octave: number, cents: number, midi: number, target: number } | null}
 *   `null` if hz is non-positive or non-finite. `cents` is signed (-50..+50);
 *   `target` is the exact frequency of the named note.
 */
export function frequencyToNote(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const midiFloat = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const target = 440 * Math.pow(2, (midi - 69) / 12);
  return { note: name, octave, cents, midi, target };
}

/**
 * Return the 7 pitch-class names belonging to a given musical key
 * (no octaves). Uses the canonical sharp spellings from NOTE_NAMES.
 * @param {string} key One of MUSICAL_KEYS, e.g. "A minor".
 * @returns {string[]} 7 note names ordered tonic-first.
 */
export function getScaleNotes(key) {
  if (!MUSICAL_KEYS.includes(key)) {
    throw new Error(`Unknown key: ${key}`);
  }
  const [tonic, mode] = key.split(' ');
  const intervals = mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const tonicIdx = NAME_TO_SEMITONE[tonic];
  return intervals.map((step) => NOTE_NAMES[(tonicIdx + step) % 12]);
}

const TUNER_NOTE_RE = /^[A-G][#b]?[0-7]$/;

/**
 * Valida los params del afinador provenientes de la canción.
 * @param {Record<string,string>} params
 * @returns {{ note: string|null, fromSongId: string|null }}
 */
export function parseTunerTarget(params = {}) {
  const ref = params.ref;
  const note = typeof ref === 'string' && TUNER_NOTE_RE.test(ref) ? ref : null;
  const fromSongId = params.from ? params.from : null;
  return { note, fromSongId };
}

/** Standard guitar tuning (E standard), low → high. */
export const GUITAR_STANDARD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

/**
 * Given a frequency, find the closest string from a tuning array
 * and the cents deviation.
 * @param {number} hz
 * @param {string[]} [tuning=GUITAR_STANDARD]
 * @returns {{ string: string, target: number, cents: number } | null}
 */
export function nearestString(hz, tuning = GUITAR_STANDARD) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  let best = null;
  let bestAbs = Infinity;
  for (const s of tuning) {
    const target = noteToFrequency(s);
    const cents = 1200 * Math.log2(hz / target);
    if (Math.abs(cents) < bestAbs) {
      bestAbs = Math.abs(cents);
      best = { string: s, target, cents: Math.round(cents) };
    }
  }
  return best;
}
