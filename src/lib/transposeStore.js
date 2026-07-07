/**
 * transposeStore.js — Persistencia de transposición POR CANCIÓN (T3).
 *
 * A diferencia de la notación de acordes (chordNotation.js, setting global),
 * la transposición es propia de cada canción: `hkn-transpose:{songId}`.
 * Tolera localStorage roto (Safari privado, cuota) — best-effort, nunca lanza.
 */

const PREFIX = 'hkn-transpose:';

/**
 * Normaliza semitonos a su equivalente musical en el rango [-11..11] por
 * wrap simétrico: +12 → 0, −12 → 0, +13 → +1 (el ciclo continúa en la misma
 * dirección). Usada tanto por el contador vivo (handlers ++/--) como por el
 * store, para que bubble, render y persistencia vean siempre el mismo valor.
 * Entrada no entera → 0.
 * @param {number} value
 * @returns {number}
 */
export function normalizeSemitones(value) {
  if (!Number.isInteger(value)) return 0;
  // n % 12 ya cae en (-11..11) cuando |n| < 144 (rango real de uso); el `|| 0`
  // convierte -0 → 0 (múltiplos negativos de 12) para que el signo del bubble
  // ('Original' vs '−n') sea correcto.
  return (value % 12) || 0;
}

// Alias interno: validación defensiva de datos persistidos con la misma
// semántica de wrap (nunca le llega ±12 desde el contador vivo, pero datos
// legacy fuera de rango en storage no deben crashear).
const clampSemitones = normalizeSemitones;

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
