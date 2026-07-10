/**
 * immersiveStore.js — Estado del modo de contenido de la vista inmersiva
 * (karaoke Apple Music style).
 *
 * Independiente del layerStore excluyente de la vista normal (decision 3
 * del spec de vista inmersiva): cambiar el modo aca NO toca las capas de
 * SongView/StageMode. Persiste una preferencia GLOBAL del dispositivo bajo
 * `hkn-immersive-mode`. Tolera localStorage roto (Safari privado, cuota) —
 * best-effort, nunca lanza.
 */

const KEY = 'hkn-immersive-mode';
const DEFAULT_MODE = 'letra';
const VALID_MODES = ['letra', 'chords', 'mixed', 'tono'];

/**
 * Lee el modo persistido. Default `'letra'` sin guardar, valor invalido o
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
 * Persiste el modo elegido por el usuario. Valores invalidos se ignoran
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
 * Deriva el modo inicial de sesion a partir de las capas de la vista
 * normal (letra/acordes/tono), para cuando el usuario todavia no eligio un
 * modo propio en la vista inmersiva. Helper puro, no persiste — el caller
 * debe preferir un valor ya persistido (`getImmersiveMode()`) sobre este
 * fallback cuando exista.
 * @param {{ chords: boolean, tono: boolean }} layers
 * @returns {'letra'|'chords'|'mixed'|'tono'}
 */
export function inheritFromLayers(layers) {
  const chords = layers?.chords === true;
  const tono = layers?.tono === true;
  if (chords && tono) return 'mixed';
  if (chords) return 'chords';
  if (tono) return 'tono';
  return 'letra';
}

/**
 * Modos disponibles segun la disponibilidad de acordes y tono de la
 * cancion actual. `hasChords`/`tonoAvailable` los calcula el caller (misma
 * señal que usan SongView/StageMode: `songHasChords(song)` local a cada
 * componente y `isFeatureEnabled('voz_tono') && song.voiceRoster.length >
 * 0`) — no se duplica esa logica aca porque no esta expuesta como export
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
