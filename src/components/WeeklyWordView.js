// src/components/WeeklyWordView.js
// Vista de detalle de una "Palabra de la semana" (weekly_word).
// Una columna centrada, max-width legible. No reutiliza SongView.

import '../styles/weekly-word.css';
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
 * El título litúrgico del ordo suele traer la fecha y el color
 * ("14 Junio, Domingo. 11ª Sem. del Tiempo Ordinario, Verde"), redundantes con
 * la fecha formateada y el chip de color. Deja solo la descripción litúrgica.
 * @param {string|null|undefined} title
 * @returns {string}
 */
function cleanLiturgicalTitle(title) {
  if (!title) return '';
  let t = String(title).trim();
  // Quita el prefijo de fecha/día si lo hay: todo lo previo al primer ". "
  // cuando ese prefijo contiene un número (la fecha).
  const dotIdx = t.indexOf('. ');
  if (dotIdx !== -1 && /\d/.test(t.slice(0, dotIdx))) {
    t = t.slice(dotIdx + 2);
  }
  // Quita el color litúrgico al final (ya está en el chip).
  return t.replace(/,\s*(verde|morado|blanco|rojo|rosa|rosáceo|púrpura|violeta)\s*$/i, '').trim();
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
  const cleanTitle = cleanLiturgicalTitle(word.liturgical_title);
  const fontSize = getVozFontSize();

  container.innerHTML = `
    <div class="voz-view fade-in">

      <!-- Breadcrumb -->
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/" id="voz-breadcrumb-home">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <a href="#/voces" id="voz-breadcrumb-album">Voces en off</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">${escapeHtml(word.gospel_ref)}</span>
      </nav>

      <!-- Hero litúrgico — vars asignadas post-render via style.setProperty() -->
      <div class="voz-view__hero">
        <p class="voz-view__eyebrow">
          <span class="voz-view__eyebrow-inner">${icon('gospel', { size: 15 })} Palabra de la semana</span>
        </p>
        <h1 class="voz-view__title">
          ${escapeHtml(word.gospel_ref)}
        </h1>
        <p class="voz-view__meta">
          ${escapeHtml(dateLabel)}${cleanTitle ? ` · ${escapeHtml(cleanTitle)}` : ''}
        </p>
        ${word.liturgical_color ? `<span class="voz-view__color-chip">${escapeHtml(palette.label)}</span>` : ''}
      </div>

      <!-- Barra de acciones: tamaño de letra (+ editar si admin) -->
      <div class="voz-view__toolbar">
        <div class="font-controls" role="group" aria-label="Tamaño de letra">
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
      <section class="voz-view__block voz-view__gospel" aria-label="Evangelio">
        <p class="voz-view__gospel-label">
          Evangelio · ${escapeHtml(word.gospel_ref)}
        </p>
        <pre class="voz-view__gospel-body">${escapeHtml(word.gospel_body)}</pre>
        <p class="voz-view__gospel-footnote">
          Fuente: Ordo · snapshot · editable
        </p>
      </section>`
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
      <div class="empty-state__icon">${icon('gospel', { size: 40 })}</div>
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
      <div class="voz-view__error">
        <div class="empty-state fade-in">
          <div class="empty-state__icon">${icon('frown', { size: 48 })}</div>
          <h2 class="empty-state__title">Voz en off no encontrada</h2>
          <button class="btn btn--primary" id="voz-go-home">Volver al inicio</button>
        </div>
      </div>
    `;
    container.querySelector('#voz-go-home')?.addEventListener('click', () => navigate('/'));
  }
}
