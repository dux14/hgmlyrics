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
import { projectCanonicalLines } from '../align.js';

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
 * true si la letra del cancionero (songs.sections) diverge de la aprobada del
 * pipeline (song_pipeline_lyrics.sections): distinto número de renglones
 * canónicos, o algún texto distinto. Señal de lectura para el GET del run
 * (api/songs/[id]/pipeline.js) — el PUT ya sabe si divergió (propagó o no)
 * pero un consumidor que solo lee el run necesita recalcularlo.
 * @param {Array} songSections songs.sections actual
 * @param {Array} storeSections song_pipeline_lyrics.sections
 * @returns {boolean}
 */
export function songbookDiverged(songSections, storeSections) {
  const canonical = projectCanonicalLines(songSections);
  const flat = (storeSections || []).flatMap((section) => section.lines || []);
  if (canonical.length !== flat.length) return true;
  return canonical.some((line, idx) => line.text !== (flat[idx]?.text ?? ''));
}
