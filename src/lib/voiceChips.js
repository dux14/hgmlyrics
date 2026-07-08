/**
 * voiceChips.js — markup del chip de selector de voz (S·A·T·B) del chrome del
 * stage (StageMode). También exporta `categoryInitial`, la derivación de
 * inicial compartida con el hero de SongView (renderHeroVoiceChips), que no
 * usa `buildVoiceChipHTML` porque su markup incluye nota + dot propios.
 */

import { getVoiceLabel } from './voiceSystem.js';
import { escapeHtml } from './escape.js';

/**
 * Inicial de categoría para el chip: "A" de Alto (mockup) para contralto;
 * el label accesible completo va aparte (aria-label).
 * @param {string} category
 * @returns {string}
 */
export function categoryInitial(category) {
  return category === 'contralto' ? 'A' : getVoiceLabel(category).charAt(0).toUpperCase();
}

/**
 * @param {string} category
 * @param {{ active?: boolean, dimmed?: boolean, prefix: string }} opts
 *   `prefix` es la clase base BEM del chip (p.ej. "stage-v2__voice-chip");
 *   los modificadores `--active`/`--dimmed` se derivan de ella.
 * @returns {string}
 */
export function buildVoiceChipHTML(category, { active = false, dimmed = false, prefix }) {
  const initial = categoryInitial(category);
  const cls = [prefix, active ? `${prefix}--active` : '', dimmed ? `${prefix}--dimmed` : '']
    .filter(Boolean)
    .join(' ');
  return `
      <button
        type="button"
        class="${cls}"
        data-category="${category}"
        style="--voice-chip-color: var(--color-voice-${category})"
        aria-pressed="${active}"
        aria-label="Voz: ${escapeHtml(getVoiceLabel(category))}"
      >${initial}</button>`;
}
