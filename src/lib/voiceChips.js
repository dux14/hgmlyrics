/**
 * voiceChips.js — markup compartido de los chips de selector de voz (S·A·T·B),
 * usado por el hero de SongView y el chrome del stage (StageMode). Cada
 * llamador define su propio prefijo de clase BEM; el resto (inicial,
 * data-category, color, aria) es idéntico.
 */

import { getVoiceLabel } from './voiceSystem.js';
import { escapeHtml } from './escape.js';

/**
 * @param {string} category
 * @param {{ active?: boolean, dimmed?: boolean, prefix: string }} opts
 *   `prefix` es la clase base BEM del chip (p.ej. "hero-voice-chip" o
 *   "stage-v2__voice-chip"); los modificadores `--active`/`--dimmed` se
 *   derivan de ella.
 * @returns {string}
 */
export function buildVoiceChipHTML(category, { active = false, dimmed = false, prefix }) {
  // "A" de Alto (mockup) para contralto; label accesible completo aparte.
  const initial = category === 'contralto' ? 'A' : getVoiceLabel(category).charAt(0).toUpperCase();
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
