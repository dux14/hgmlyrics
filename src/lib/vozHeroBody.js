// src/lib/vozHeroBody.js
// Markup compartido del hero + cuerpo de una voz en off (weekly_word).
// Consumido tanto por WeeklyWordView (vista pública) como por el preview de
// VozEditor, para que ambas vistas nunca diverjan. Puro: solo genera un
// string de HTML (con escape), sin el chrome propio de cada vista — sin
// font-controls, sin botón Editar, sin toolbar. Las vars litúrgicas
// (--liturgical-*) las asigna cada vista tras insertar este HTML.
import { splitVoiceover } from './voiceover.js';
import { voiceoverHero } from './voiceoverHero.js';
import { escapeHtml } from './escape.js';
import { icon } from './icons.js';

/**
 * Genera el HTML del hero litúrgico + cuerpo (cita/reflexión) + evangelio
 * de una voz en off.
 * @param {{ sunday_date?: string|null, gospel_ref?: string|null, liturgical_title?: string|null,
 *   liturgical_color?: string|null, voiceover_body?: string|null, gospel_body?: string|null }} word
 * @returns {string}
 */
export function vozHeroBodyHtml(word) {
  const { scripture, reflection } = splitVoiceover(word.voiceover_body, word.gospel_body);
  const { pillLabel, bigTitle, metaLine } = voiceoverHero(word);

  return `
    <div class="voz-view__hero">
      ${
        pillLabel
          ? `<span class="voz-view__pill"><span class="voz-view__pill-dot"></span>${escapeHtml(pillLabel)}</span>`
          : ''
      }
      <p class="voz-view__eyebrow">
        <span class="voz-view__eyebrow-inner">${icon('gospel', { size: 15 })} Palabra de la semana</span>
      </p>
      <h1 class="voz-view__title">
        ${escapeHtml(bigTitle)}
      </h1>
      <p class="voz-view__meta">
        ${escapeHtml(metaLine)}
      </p>
    </div>

    <section class="voz-view__block" aria-label="Voz en off">
      ${
        scripture
          ? `
      <div class="voz__scripture">
        <pre class="voz__prose">${escapeHtml(scripture)}</pre>
      </div>`
          : ''
      }

      ${
        reflection
          ? `
      <div class="voz__reflection-sep">
        ${icon('sparkles', { size: 14 })} Reflexión
      </div>
      <pre class="voz__reflection voz__prose">${escapeHtml(reflection)}</pre>`
          : !scripture
            ? `
      <pre class="voz__reflection voz__prose">${escapeHtml(word.voiceover_body || '')}</pre>`
            : ''
      }
    </section>

    ${
      word.gospel_body
        ? `
    <details class="voz-view__block voz-view__gospel">
      <summary class="voz-view__gospel-label">
        Evangelio del día · ${escapeHtml(word.gospel_ref)}
      </summary>
      <pre class="voz-view__gospel-body">${escapeHtml(word.gospel_body)}</pre>
      <p class="voz-view__gospel-footnote">
        Fuente: Ordo · snapshot · editable
      </p>
    </details>`
        : ''
    }
  `;
}
