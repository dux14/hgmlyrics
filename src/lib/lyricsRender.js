/**
 * lyricsRender.js — Builders puros de HTML por modo de lectura (Letra/Acordes/Tono).
 *
 * Componen los primitivos del modelo v3 de voiceSystem.js (buildAnnotatedLineHTML,
 * groupsForVoice) en HTML listo para el lector y para la vista previa del editor.
 * Sin DOM → testeable como string.
 */
import { buildAnnotatedLineHTML } from './voiceSystem.js';

/**
 * Modo Letra (GA): texto blanco plano, escapado, sin etiquetas ni color.
 * @param {string} text
 * @returns {string} HTML
 */
export function buildLetraLineHTML(text) {
  return buildAnnotatedLineHTML(text || '', {});
}
