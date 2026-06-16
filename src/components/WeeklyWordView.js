// src/components/WeeklyWordView.js
// Vista de detalle de una "Palabra de la semana" (weekly_word).
// Una columna centrada, max-width legible. No reutiliza SongView.

import { navigate } from '../router.js';
import { isAdmin } from '../lib/authStore.js';
import { splitVoiceover } from '../lib/voiceover.js';
import { liturgicalPalette, coverGradient } from '../lib/liturgicalColor.js';
import { escapeHtml } from '../lib/escape.js';
import { icon } from '../lib/icons.js';

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
 * Formatea una fecha ISO (YYYY-MM-DD) como "15 de junio de 2026".
 * @param {string} isoDate
 * @returns {string}
 */
function formatSundayDate(isoDate) {
  if (!isoDate) return '';
  // La columna es DATE pero la API puede devolver un timestamp ISO completo
  // ("2026-06-14T00:00:00.000Z"); nos quedamos con la parte YYYY-MM-DD.
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('es', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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
  const dateLabel = formatSundayDate(word.sunday_date);
  const fontSize = getVozFontSize();

  // Estilos compartidos por los bloques de texto: color pleno + buen interlineado.
  const proseStyle =
    'white-space: pre-wrap; font-family: inherit; margin: 0; color: var(--color-text); font-size: var(--voz-fs); line-height: 1.75;';

  container.innerHTML = `
    <div class="voz-view fade-in" style="max-width: 680px; margin: 0 auto; padding: 1.5rem 1rem; --voz-fs: ${fontSize}rem;">

      <!-- Breadcrumb -->
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/" id="voz-breadcrumb-home">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <a href="#/voces" id="voz-breadcrumb-album">Voces en off</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">${escapeHtml(word.gospel_ref)}</span>
      </nav>

      <!-- Hero -->
      <div class="voz-view__hero" style="background: ${gradient}; border-radius: var(--border-radius-lg); padding: 2rem 1.5rem; margin: 1rem 0 1.5rem; color: ${palette.text};">
        <p class="voz-view__eyebrow" style="font-size: 0.8rem; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.85; margin: 0 0 0.5rem;">
          🕊 Palabra de la semana
        </p>
        <h1 class="voz-view__title" style="font-size: 1.8rem; font-weight: 700; margin: 0 0 0.75rem; color: inherit;">
          ${escapeHtml(word.gospel_ref)}
        </h1>
        <p style="margin: 0; opacity: 0.92; font-size: 0.9rem;">
          ${escapeHtml(dateLabel)}
          ${word.liturgical_title ? ` · ${escapeHtml(word.liturgical_title)}` : ''}
        </p>
        ${word.liturgical_color ? `<span class="voz-view__color-chip" style="display: inline-block; margin-top: 0.75rem; background: ${palette.accent}; color: ${palette.bg}; border-radius: 999px; padding: 0.2em 0.75em; font-size: 0.75rem; font-weight: 600;">${escapeHtml(palette.label)}</span>` : ''}
      </div>

      <!-- Barra de acciones: tamaño de letra (+ editar si admin) -->
      <div class="voz-view__toolbar" style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 1.25rem;">
        <div class="font-controls" style="display: flex; align-items: center; gap: 0.4rem;" role="group" aria-label="Tamaño de letra">
          <button class="font-controls__btn" id="voz-font-dec" aria-label="Reducir tamaño de letra">A−</button>
          <span class="font-controls__label" id="voz-font-label" aria-live="polite">${Math.round(fontSize * 100)}%</span>
          <button class="font-controls__btn" id="voz-font-inc" aria-label="Aumentar tamaño de letra">A+</button>
        </div>
        ${
          isAdmin()
            ? `<button class="btn btn--secondary" data-action="edit-voz">${icon('pencil', { size: 16 })} Editar</button>`
            : ''
        }
      </div>

      <!-- Bloque Voz en off -->
      <section class="voz-view__block" aria-label="Voz en off">
        ${
          scripture
            ? `
        <div class="voz__scripture" style="border-left: 3px solid ${palette.accent}; padding-left: 1rem; margin-bottom: 1.25rem; font-style: italic;">
          <pre style="${proseStyle}">${escapeHtml(scripture)}</pre>
        </div>`
            : ''
        }

        ${
          reflection
            ? `
        <div class="voz__reflection-sep" style="display: flex; align-items: center; gap: 0.75rem; margin: 1.5rem 0; color: ${palette.accent}; font-size: 0.85rem; font-weight: 600; letter-spacing: 0.08em;">
          <span style="flex: 1; height: 1px; background: ${palette.accent}; opacity: 0.35;"></span>
          ✦ Reflexión
          <span style="flex: 1; height: 1px; background: ${palette.accent}; opacity: 0.35;"></span>
        </div>
        <pre class="voz__reflection" style="${proseStyle}">${escapeHtml(reflection)}</pre>`
            : !scripture
              ? `
        <pre class="voz__reflection" style="${proseStyle}">${escapeHtml(word.voiceover_body || '')}</pre>`
              : ''
        }
      </section>

      <!-- Bloque Evangelio -->
      ${
        word.gospel_body
          ? `
      <section class="voz-view__block voz-view__gospel" style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--color-border);" aria-label="Evangelio">
        <p class="voz-view__gospel-label" style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.1em; color: ${palette.accent}; font-weight: 600; margin: 0 0 0.75rem;">
          Evangelio · ${escapeHtml(word.gospel_ref)}
        </p>
        <pre style="white-space: pre-wrap; font-family: inherit; margin: 0 0 0.5rem; color: var(--color-text); font-size: calc(var(--voz-fs) * 0.94); line-height: 1.7;">${escapeHtml(word.gospel_body)}</pre>
        <p style="font-size: 0.7rem; color: var(--color-text-secondary); margin: 0;">
          Fuente: Ordo · snapshot · editable
        </p>
      </section>`
          : ''
      }

    </div>
  `;

  const viewEl = container.querySelector('.voz-view');
  const labelEl = container.querySelector('#voz-font-label');
  let currentSize = fontSize;

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

  container.querySelector('#voz-breadcrumb-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });
  container.querySelector('#voz-breadcrumb-album')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/voces');
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
  container.innerHTML = `
    <div class="empty-state fade-in">
      <div class="empty-state__icon">🕊</div>
      <h2 class="empty-state__title">Cargando...</h2>
    </div>
  `;
  try {
    const { supabase } = await import('../lib/supabase.js');
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    const res = await fetch(`/api/weekly-words/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const word = await res.json();
    await renderWeeklyWordView(container, word);
  } catch (_e) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">${icon('frown', { size: 48 })}</div>
        <h2 class="empty-state__title">Voz en off no encontrada</h2>
        <button class="btn btn--primary" id="voz-go-home" style="margin-top: 1rem;">Volver al inicio</button>
      </div>
    `;
    container.querySelector('#voz-go-home')?.addEventListener('click', () => navigate('/'));
  }
}
