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

// ChordPro directives ({key: Am}, {key: F#}) usan notación compacta
// (tonic + 'm' opcional), no la forma canónica "C major"/"A minor". Solo
// sostenidos en el set canónico → los bemoles de entrada se normalizan a su
// equivalente enarmónico sostenido.
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

/**
 * Convierte notación ChordPro ("C", "Am", "F#m", "Bbm") a la forma canónica
 * de la app ("C major", "A minor"). Bemoles se normalizan a sostenidos.
 * @param {unknown} raw
 * @returns {string|null} clave canónica, o null si no es reconocible.
 */
export function chordProKeyToCanonical(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = trimmed.match(/^([A-G][#b]?)(m|min|minor)?$/);
  if (!m) return null;
  let tonic = m[1];
  if (tonic.length === 2 && tonic[1] === 'b') tonic = FLAT_TO_SHARP[tonic] || tonic;
  const mode = m[2] ? 'minor' : 'major';
  const candidate = `${tonic} ${mode}`;
  return isValidKey(candidate) ? candidate : null;
}

/**
 * Convierte una clave canónica ("C major", "A minor") a notación compacta
 * ChordPro ("C", "Am") para exportar.
 * @param {unknown} key
 * @returns {string} notación ChordPro, o '' si no es una clave canónica.
 */
export function canonicalToChordProKey(key) {
  if (!isValidKey(key)) return '';
  const [tonic, mode] = key.split(' ');
  return mode === 'minor' ? `${tonic}m` : tonic;
}
