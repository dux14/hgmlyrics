/**
 * layerStore.js — Persistencia de capas de lectura (Acordes/Tono) para la
 * toolbar de la vista de canción (T3).
 *
 * A diferencia de la transposición (transposeStore.js, por canción), las
 * capas son una preferencia GLOBAL del dispositivo: `hkn-lyrics-layers`.
 * Las capas son EXCLUYENTES (pivote de diseño post-QA visual): activar una
 * apaga la otra. `getLayers()` normaliza cualquier valor persistido viejo con
 * ambas en true (versiones previas permitían independencia) — en ese caso
 * `chords` gana el empate. Tolera localStorage roto (Safari privado, cuota)
 * — best-effort, nunca lanza.
 */

const KEY = 'hkn-lyrics-layers';

/**
 * Lee las capas activas, normalizadas a exclusión mutua. Default sin
 * guardar o ante cualquier fallo: `{ chords: false, tono: false }`. Si un
 * valor persistido (de una versión previa no exclusiva) tiene ambas en
 * true, `chords` gana el empate.
 * @returns {{ chords: boolean, tono: boolean }}
 */
export function getLayers() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { chords: false, tono: false };
    const parsed = JSON.parse(raw);
    const chords = parsed?.chords === true;
    const tono = parsed?.tono === true;
    if (chords && tono) return { chords: true, tono: false };
    return { chords, tono };
  } catch {
    return { chords: false, tono: false };
  }
}

/**
 * Activa/desactiva una capa y persiste el par completo. Al activar una capa
 * (`on === true`), apaga la otra (exclusión mutua). Silencioso si
 * localStorage falla.
 * @param {'chords'|'tono'} name
 * @param {boolean} on
 */
export function setLayer(name, on) {
  if (name !== 'chords' && name !== 'tono') return;
  try {
    const current = getLayers();
    current[name] = on === true;
    if (current[name]) {
      const other = name === 'chords' ? 'tono' : 'chords';
      current[other] = false;
    }
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // best-effort — la persistencia es una mejora, no un requisito.
  }
}

/**
 * Deriva el `viewMode` interno de SongView/ImmersiveView a partir de las capas.
 * Con capas excluyentes, 'mixed' ya no es alcanzable desde el store (queda
 * el mapeo por compatibilidad con valores persistidos viejos que aún no
 * pasaron por `getLayers()`). Helper puro, sin acceso a storage, para que
 * SongView (render inicial + toggleLayer) y ImmersiveView (T6) compartan el
 * mismo mapeo.
 * @param {{ chords: boolean, tono: boolean }} layers
 * @returns {'lyrics'|'chords'|'tono'|'mixed'}
 */
export function deriveViewMode(layers) {
  if (layers?.chords && layers?.tono) return 'mixed';
  if (layers?.tono) return 'tono';
  if (layers?.chords) return 'chords';
  return 'lyrics';
}
