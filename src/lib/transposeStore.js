/**
 * transposeStore.js — Persistencia de transposición POR CANCIÓN (T3).
 *
 * A diferencia de la notación de acordes (chordNotation.js, setting global),
 * la transposición es propia de cada canción: `hkn-transpose:{songId}`.
 * Tolera localStorage roto (Safari privado, cuota) — best-effort, nunca lanza.
 */

const PREFIX = 'hkn-transpose:';
const MAX_SEMITONES = 11;
const MIN_SEMITONES = -11;

function clampSemitones(value) {
  const n = Number.isInteger(value) ? value : 0;
  return Math.min(MAX_SEMITONES, Math.max(MIN_SEMITONES, n));
}

/**
 * Lee la transposición guardada para una canción. Default sin guardar o ante
 * cualquier fallo: `{ semitones: 0, useFlats: false }`.
 * @param {string} songId
 * @returns {{ semitones: number, useFlats: boolean }}
 */
export function getTranspose(songId) {
  if (!songId) return { semitones: 0, useFlats: false };
  try {
    const raw = localStorage.getItem(PREFIX + songId);
    if (!raw) return { semitones: 0, useFlats: false };
    const parsed = JSON.parse(raw);
    return { semitones: clampSemitones(parsed?.semitones), useFlats: parsed?.useFlats === true };
  } catch {
    return { semitones: 0, useFlats: false };
  }
}

/**
 * Persiste la transposición de una canción. Silencioso si localStorage falla.
 * @param {string} songId
 * @param {{ semitones: number, useFlats: boolean }} value
 */
export function setTranspose(songId, { semitones, useFlats } = {}) {
  if (!songId) return;
  try {
    localStorage.setItem(
      PREFIX + songId,
      JSON.stringify({ semitones: clampSemitones(semitones), useFlats: useFlats === true }),
    );
  } catch {
    // best-effort — la persistencia es una mejora, no un requisito.
  }
}
