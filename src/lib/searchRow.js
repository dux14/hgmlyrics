// src/lib/searchRow.js
// Markup compartido para una fila de resultado de "voz en off" (weekly_word).
// Lo usan el buscador del header y el wizard de listas para que SIEMPRE se vean
// idénticos (misma estructura, mismos estilos): un único origen de verdad evita
// que ambos buscadores diverjan visualmente.

import { escapeHtml } from './escape.js';
import { voiceoverCoverHtml } from './voiceoverCover.js';

/**
 * Devuelve el HTML de una fila de resultado para una voz en off.
 * El contenedor expone `data-voz-id` para enganchar el click.
 * @param {object} item - weekly_word { id, gospel_ref, liturgical_title }
 * @returns {string}
 */
export function weeklyWordSearchRow(item) {
  return `
    <div class="search-results__item" data-voz-id="${escapeHtml(item.id)}">
      ${voiceoverCoverHtml(item.liturgical_color, { size: 32, radius: 6 })}
      <div>
        <div style="font-weight: 600; font-size: 0.875rem;">${escapeHtml(item.gospel_ref)}</div>
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span style="font-size: 0.75rem; color: var(--color-text-secondary);">${escapeHtml(item.liturgical_title || 'Voz en off')}</span>
          <span style="background: #2563eb; color: #fff; border-radius: 999px; padding: 0.1em 0.5em; font-size: 0.65rem; font-weight: 700;">VOZ EN OFF</span>
        </div>
      </div>
    </div>
  `;
}
