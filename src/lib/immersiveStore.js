/**
 * immersiveStore.js — Estado del modo de contenido de la vista inmersiva
 * (karaoke Apple Music style).
 *
 * Independiente del layerStore excluyente de la vista normal (decisión 3
 * del spec de vista inmersiva): cambiar el modo aquí NO toca las capas de
 * SongView/ImmersiveView. Persiste una preferencia GLOBAL del dispositivo bajo
 * `hkn-immersive-mode`. Tolera localStorage roto (Safari privado, cuota) —
 * best-effort, nunca lanza.
 */

const KEY = 'hkn-immersive-mode';
const DEFAULT_MODE = 'letra';
const VALID_MODES = ['letra', 'chords', 'mixed', 'tono'];

/**
 * Lee el modo persistido. Default `'letra'` sin guardar, valor inválido o
 * ante cualquier fallo de localStorage.
 * @returns {'letra'|'chords'|'mixed'|'tono'}
 */
export function getImmersiveMode() {
  try {
    const raw = localStorage.getItem(KEY);
    return VALID_MODES.includes(raw) ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/**
 * Persiste el modo elegido por el usuario. Valores inválidos se ignoran
 * (no se escribe nada). Silencioso si localStorage falla.
 * @param {string} mode
 */
export function setImmersiveMode(mode) {
  if (!VALID_MODES.includes(mode)) return;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // best-effort — la persistencia es una mejora, no un requisito.
  }
}

/**
 * Modos disponibles según la disponibilidad de acordes y tono de la
 * canción actual. `hasChords`/`tonoAvailable` los calcula el caller (misma
 * señal que usan SongView/ImmersiveView: `songHasChords(song)` local a cada
 * componente y `isFeatureEnabled('voz_tono') && song.voiceRoster.length >
 * 0`) — no se duplica esa lógica aquí porque no está expuesta como export
 * reusable desde donde vive hoy.
 * @param {{ hasChords: boolean, tonoAvailable: boolean }} availability
 * @returns {Array<'letra'|'chords'|'mixed'|'tono'>}
 */
export function availableModes({ hasChords, tonoAvailable } = {}) {
  const modes = ['letra'];
  if (hasChords) modes.push('chords');
  if (hasChords && tonoAvailable) modes.push('mixed');
  if (tonoAvailable) modes.push('tono');
  return modes;
}
