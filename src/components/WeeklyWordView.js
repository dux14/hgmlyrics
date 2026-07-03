// src/components/WeeklyWordView.js
// Vista de detalle de una "Palabra de la semana" (weekly_word).
// Una columna centrada, max-width legible. No reutiliza SongView.

import '../styles/weekly-word.css';
import { navigate } from '../router.js';
import { isAdmin } from '../lib/authStore.js';
import { splitVoiceover } from '../lib/voiceover.js';
import { liturgicalPalette, coverGradient } from '../lib/liturgicalColor.js';
import { voiceoverHero } from '../lib/voiceoverHero.js';
import { escapeHtml } from '../lib/escape.js';
import { icon } from '../lib/icons.js';
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelLongText } from '../lib/skeleton.js';

// Tamaño de letra del lector de voces en off (persistido, propio del módulo).
const VOZ_FONT_KEY = 'hkn-voz-font-size';
const VOZ_FONT_MIN = 0.9;
const VOZ_FONT_MAX = 1.7;
const VOZ_FONT_STEP = 0.1;
const VOZ_FONT_DEFAULT = 1.1;

function getVozFontSize() {
  const raw = parseFloat(localStorage.getItem(VOZ_FONT_KEY));
  if (Number.isNaN(raw)) return VOZ_FONT_DEFAULT;
  return Math.min(VOZ_FONT_MAX, Math.max(VOZ_FONT_MIN, raw));
}

/**
 * Renderiza la vista de detalle de una voz en off.
 * @param {HTMLElement} container
 * @param {object} word - Objeto weekly_word completo
 */
export async function renderWeeklyWordView(container, word) {
  const palette = liturgicalPalette(word.liturgical_color);
  const gradient = coverGradient(palette);
  const { scripture, reflection } = splitVoiceover(word.voiceover_body, word.gospel_body);
  const { pillLabel, bigTitle, metaLine } = voiceoverHero(word);
  const fontSize = getVozFontSize();

  container.innerHTML = `
    <div class="voz-view fade-in">

      <!-- Hero litúrgico — vars asignadas post-render via style.setProperty() -->
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

      <!-- Barra de acciones: tamaño de letra -->
      <div class="voz-view__toolbar">
        <div class="font-controls" role="group" aria-label="Tamaño de letra">
          <button class="font-controls__btn" id="voz-font-dec" aria-label="Reducir tamaño de letra">A−</button>
          <span class="font-controls__label" id="voz-font-label" aria-live="polite">${Math.round(fontSize * 100)}%</span>
          <button class="font-controls__btn" id="voz-font-inc" aria-label="Aumentar tamaño de letra">A+</button>
        </div>
      </div>

      <!-- Bloque Voz en off -->
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

      <!-- Bloque Evangelio -->
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

      ${
        isAdmin()
          ? `<button class="btn voz-view__edit-cta" data-action="edit-voz">${icon('pencil', { size: 16 })} Editar voz en off</button>`
          : ''
      }

    </div>
  `;

  const viewEl = container.querySelector('.voz-view');
  const heroEl = container.querySelector('.voz-view__hero');
  const labelEl = container.querySelector('#voz-font-label');
  let currentSize = fontSize;

  // Tamaño de letra inicial y vars litúrgicas del hero
  viewEl.style.setProperty('--voz-fs', `${currentSize}rem`);
  heroEl.style.setProperty('--liturgical-gradient', gradient);
  heroEl.style.setProperty('--liturgical-accent', palette.accent);
  heroEl.style.setProperty('--liturgical-text', palette.text);
  heroEl.style.setProperty('--liturgical-bg', palette.bg);

  function applyFont(size) {
    currentSize = Math.min(VOZ_FONT_MAX, Math.max(VOZ_FONT_MIN, size));
    viewEl.style.setProperty('--voz-fs', `${currentSize}rem`);
    labelEl.textContent = `${Math.round(currentSize * 100)}%`;
    localStorage.setItem(VOZ_FONT_KEY, String(currentSize));
  }

  container.querySelector('#voz-font-dec')?.addEventListener('click', () => {
    applyFont(currentSize - VOZ_FONT_STEP);
  });
  container.querySelector('#voz-font-inc')?.addEventListener('click', () => {
    applyFont(currentSize + VOZ_FONT_STEP);
  });

  container.querySelector('[data-action="edit-voz"]')?.addEventListener('click', () => {
    navigate(`/admin/voz/${word.id}`);
  });
}

/**
 * Carga el detalle desde la API y renderiza.
 * @param {HTMLElement} container
 * @param {string} id - weekly_words.id
 */
export async function renderWeeklyWordById(container, id) {
  // Shell + región async (sin caché previa).
  container.innerHTML = `
    <div class="voz-view__shell">
      <div class="voz-view__region" aria-busy="true"></div>
    </div>
  `;
  const region = container.querySelector('.voz-view__region');

  renderAsyncRegion(region, {
    skeleton: () => skelLongText(),
    fetcher: async () => {
      const { supabase } = await import('../lib/supabase.js');
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const res = await fetch(`/api/weekly-words/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    render: (word) => renderWeeklyWordView(container, word),
    empty: () => `
      <div class="empty-state">
        <div class="empty-state__icon">${icon('frown', { size: 48 })}</div>
        <h2 class="empty-state__title">Voz en off no encontrada</h2>
        <a class="btn btn--primary" href="#/">Volver al inicio</a>
      </div>`,
    onError: () => `
      <div class="empty-state">
        <div class="empty-state__icon">${icon('frown', { size: 48 })}</div>
        <h2 class="empty-state__title">No se pudo cargar la voz en off</h2>
        <button class="btn btn--primary" data-retry>Reintentar</button>
      </div>`,
  });
}
