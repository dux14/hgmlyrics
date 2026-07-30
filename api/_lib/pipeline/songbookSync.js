/**
 * songbookSync.js — sincroniza el texto editado en el cancionero
 * (songs.sections) hacia el store propio de letra del pipeline
 * (song_pipeline_lyrics) cuando el editor NO cambió el número de renglones
 * canónicos. El karaoke (api/songs/[id]/audio.js) lee texto del store, no de
 * songs.sections, así que corregir una tilde en el editor dejaba el karaoke
 * cantando el texto viejo sin ninguna señal visible. Dominio PURO: sin sql,
 * sin fetch, sin Date.now (mismo patrón que lyricsReview.js/lyricsStore.js en
 * este mismo directorio).
 */
import { tokenCount } from './lyricsReview.js';
import { exportSections, SECTION_LABELS } from './songbookExport.js';

/**
 * Propaga el texto canónico del cancionero al store del pipeline, solo si el
 * número de renglones coincide 1:1 (mismo orden/índice que
 * projectCanonicalLines: secciones en orden de documento, renglones
 * `annotation` saltados). Conserva startMs/endMs/manualStartMs/vocalization/
 * confidence de cada renglón (spread: cualquier otro campo del store viaja
 * intacto). `words` se descarta cuando el conteo de tokens del texto nuevo no
 * coincide con el de `words` — mismo criterio que `editLine` en
 * lyricsReview.js: pipelineLinesFor toma el endMs de la ÚLTIMA word para
 * acotar el segmento del forced align, así que arrastrar words desalineadas
 * manda un rango falso a Modal. No muta `storeSections`.
 * @param {Array} storeSections song_pipeline_lyrics.sections (formato del store)
 * @param {Array<{i:number, text:string}>} canonicalLines salida de
 *   projectCanonicalLines sobre las sections nuevas del cancionero
 * @returns {Array|null} sections nuevas del store, o null si los largos no coinciden
 */
export function propagateSongbookText(storeSections, canonicalLines) {
  const flat = storeSections.flatMap((section) => section.lines);
  if (flat.length !== canonicalLines.length) return null;

  let cursor = 0;
  return storeSections.map((section) => ({
    ...section,
    lines: section.lines.map((line) => {
      const text = canonicalLines[cursor]?.text ?? '';
      cursor += 1;
      const words =
        Array.isArray(line.words) && line.words.length === tokenCount(text) ? line.words : [];
      return { ...line, text, words };
    }),
  }));
}

/**
 * Compara dos valores por estructura (no por referencia), ignorando el orden
 * de claves de los objetos: `songSections` viene de Postgres/del editor y
 * `exportSections` arma sus objetos a mano, así que nada garantiza el mismo
 * orden de inserción aunque el contenido sea idéntico. `Object.keys` +
 * `hasOwnProperty` deja la comparación de objetos ciega a ese orden; los
 * arrays sí comparan posición a posición porque ahí el orden es significado
 * (orden de secciones/renglones). Privado de este módulo, sin dependencias.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => deepEqual(item, b[idx]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
  );
}

/**
 * Completa `type`/`label` de una sección de songs.sections con el mismo
 * fallback que aplica sectionsToBlocks en SongEditor.js:97-99: hay filas
 * legacy reales nunca re-guardadas desde que se introdujo blocksToSectionsV3,
 * que llegan sin esos campos. Sin esta normalización, songbookDiverged las
 * compara contra la salida de exportSections (que SIEMPRE trae type/label) y
 * las marca como divergentes por faltarles esquema, no por texto distinto —
 * un falso positivo que le pide al admin reabrir y realinear letra que está
 * al día. No muta `section`.
 */
function normalizeSection(section) {
  const type = section.type || 'verse';
  return { ...section, type, label: section.label || SECTION_LABELS[type] || 'Verso' };
}

/**
 * true si el cancionero (songs.sections) quedaría distinto de lo que
 * produciría exportar la letra aprobada del pipeline ahora mismo: es decir,
 * si `songSections` (con `type`/`label` legacy completados, ver
 * `normalizeSection`) no es igual, estructuralmente, a
 * `exportSections(storeSections, songSections).sections`. Al pasarle
 * `songSections` como base a exportSections, el resultado ya incorpora
 * acordes/groups/anotaciones/speedPreset existentes — por eso una canción sin
 * cambios reales exporta idéntica a sí misma (exportSections es idempotente,
 * cubierto en pipelineSongbookExport.test.js) y no diverge por tener
 * anotaciones, acordes, o esquema legacy sin type/label. Señal de lectura para
 * el GET del run (api/songs/[id]/pipeline.js) — el PUT ya sabe si divergió
 * (propagó o no) pero un consumidor que solo lee el run necesita
 * recalcularlo.
 * @param {Array} songSections songs.sections actual
 * @param {Array} storeSections song_pipeline_lyrics.sections (letra aprobada)
 * @returns {boolean}
 */
export function songbookDiverged(songSections, storeSections) {
  const normalized = (songSections || []).map(normalizeSection);
  const { sections } = exportSections(storeSections || [], normalized);
  return !deepEqual(sections, normalized);
}
