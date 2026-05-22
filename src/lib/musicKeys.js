/**
 * musicKeys.js — Canonical list of musical keys recognized by the app.
 *
 * 24 entries: 12 chromatic notes × {major, minor}. Sharps only (no enharmonic
 * flats like Bb major) to keep one canonical spelling per key. The DB CHECK
 * constraint in `0008_song_key.sql` enforces the same set.
 */

const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MODES = ['major', 'minor'];

/** @type {ReadonlyArray<string>} 24 valid keys, e.g. 'A minor'. */
export const MUSICAL_KEYS = Object.freeze(
  MODES.flatMap((mode) => TONICS.map((tonic) => `${tonic} ${mode}`)),
);

const KEY_SET = new Set(MUSICAL_KEYS);

/**
 * @param {unknown} value
 * @returns {boolean} true if value is one of the 24 canonical keys.
 */
export function isValidKey(value) {
  return typeof value === 'string' && KEY_SET.has(value);
}
