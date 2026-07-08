/**
 * layerStore.js — Persistencia de capas de lectura (Acordes/Tono) para la
 * toolbar de la vista de canción (T3).
 *
 * A diferencia de la transposición (transposeStore.js, por canción), las
 * capas son una preferencia GLOBAL del dispositivo: `hkn-lyrics-layers`.
 * Ambas capas son independientes entre sí (no exclusivas como el viejo
 * mode toggle Letra/Acordes/Tono). Tolera localStorage roto (Safari privado,
 * cuota) — best-effort, nunca lanza.
 */

const KEY = 'hkn-lyrics-layers';

/**
 * Lee las capas activas. Default sin guardar o ante cualquier fallo:
 * `{ chords: false, tono: false }`.
 * @returns {{ chords: boolean, tono: boolean }}
 */
export function getLayers() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { chords: false, tono: false };
    const parsed = JSON.parse(raw);
    return { chords: parsed?.chords === true, tono: parsed?.tono === true };
  } catch {
    return { chords: false, tono: false };
  }
}

/**
 * Activa/desactiva una capa y persiste el par completo. Silencioso si
 * localStorage falla.
 * @param {'chords'|'tono'} name
 * @param {boolean} on
 */
export function setLayer(name, on) {
  if (name !== 'chords' && name !== 'tono') return;
  try {
    const current = getLayers();
    current[name] = on === true;
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // best-effort — la persistencia es una mejora, no un requisito.
  }
}

/**
 * Deriva el `viewMode` interno de SongView/StageMode a partir de las capas.
 * 'mixed' es la combinación de ambas capas encendidas (T3, toolbar de capas);
 * no es exclusivo con 'chords' — ver renderSections en SongView.js. Helper
 * puro, sin acceso a storage, para que SongView (render inicial + toggleLayer)
 * y StageMode (T6) compartan el mismo mapeo.
 * @param {{ chords: boolean, tono: boolean }} layers
 * @returns {'lyrics'|'chords'|'tono'|'mixed'}
 */
export function deriveViewMode(layers) {
  if (layers?.chords && layers?.tono) return 'mixed';
  if (layers?.tono) return 'tono';
  if (layers?.chords) return 'chords';
  return 'lyrics';
}
