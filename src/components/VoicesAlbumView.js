// src/components/VoicesAlbumView.js
// Vista virtual del álbum "Voces en off": tracklist de semanas, badge VIGENTE,
// estado vacío, acceso al detalle de cada voz.

import '../styles/voices.css';
import { navigate } from '../router.js';
import { isAdmin } from '../lib/authStore.js';
import { liturgicalPalette, coverGradient } from '../lib/liturgicalColor.js';
import { escapeHtml } from '../lib/escape.js';
import { supabase } from '../lib/supabase.js';
import { icon } from '../lib/icons.js';

/**
 * Dado un sunday_date (YYYY-MM-DD), ¿es la del domingo más reciente (≤ hoy)?
 * @param {string} sundayDate
 * @param {string} today - YYYY-MM-DD (inyectable en tests)
 * @returns {boolean}
 */
export function isVigente(sundayDate, today = new Date().toISOString().slice(0, 10)) {
  return String(sundayDate).slice(0, 10) <= today;
}

/**
 * Formatea una fecha ISO como "15 jun 2026".
 * @param {string} isoDate
 * @returns {string}
 */
function formatShortDate(isoDate) {
  // La API puede devolver un timestamp ISO completo; tomamos YYYY-MM-DD.
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Renderiza la vista del álbum "Voces en off".
 * @param {HTMLElement} container
 */
export async function renderVoicesAlbumView(container) {
  container.innerHTML = `
    <div class="empty-state fade-in">
      <div class="empty-state__icon">${icon('gospel', { size: 40 })}</div>
      <h2 class="empty-state__title">Cargando Voces en off…</h2>
    </div>
  `;

  let words = [];
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch('/api/weekly-words', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const body = await res.json();
      words = body.weeklyWords ?? [];
    }
  } catch (_e) {
    // silencioso
  }

  const today = new Date().toISOString().slice(0, 10);
  // La más reciente publicada que sea ≤ hoy es la "vigente".
  const vigenteId = words.find((w) => isVigente(w.sunday_date, today))?.id ?? null;

  if (words.length === 0) {
    container.innerHTML = `
      <div class="voz-album fade-in">
        <div class="empty-state">
          <div class="empty-state__icon">${icon('gospel', { size: 40 })}</div>
          <h2 class="empty-state__title">Aún no hay voces en off</h2>
          <p class="empty-state__text">Cada domingo se publica una reflexión sobre el evangelio.</p>
          ${isAdmin() ? `<button class="btn btn--primary" id="voz-create-btn">Crear voz en off</button>` : ''}
        </div>
      </div>
    `;
    container
      .querySelector('#voz-create-btn')
      ?.addEventListener('click', () => navigate('/admin/voz/nueva'));
    return;
  }

  const heroWord = words[0];
  const heroPalette = liturgicalPalette(heroWord.liturgical_color);
  const heroGradient = coverGradient(heroPalette);

  container.innerHTML = `
    <div class="voz-album fade-in">

      <!-- Breadcrumb -->
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/" id="voz-album-home">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">Voces en off</span>
      </nav>

      <!-- Hero portada álbum -->
      <div class="voz-album__hero">
        <div class="voz-album__hero-icon">${icon('gospel', { size: 48 })}</div>
        <h1 class="voz-album__hero-title">Voces en off</h1>
        <p class="voz-album__hero-meta">${words.length} entrada${words.length !== 1 ? 's' : ''}</p>
        ${isAdmin() ? `<button class="btn btn--sm" id="voz-create-btn">+ Nueva voz en off</button>` : ''}
      </div>

      <!-- Tracklist -->
      <ul class="voz-album__list">
        ${words
          .map((w) => {
            const isVig = w.id === vigenteId;
            return `
          <li class="voz-album__item" data-voz-id="${escapeHtml(w.id)}">
            <div class="voz-album__cover">${icon('gospel', { size: 26 })}</div>
            <div class="voz-album__meta">
              <div class="voz-album__gospel-ref">${escapeHtml(w.gospel_ref)}</div>
              <div class="voz-album__date">${escapeHtml(formatShortDate(w.sunday_date))}</div>
            </div>
            ${isVig ? `<span class="voz-album__badge--vigente">VIGENTE</span>` : ''}
          </li>`;
          })
          .join('')}
      </ul>
    </div>
  `;

  // Vars litúrgicas del hero (gradiente + acento + texto)
  const heroEl = container.querySelector('.voz-album__hero');
  if (heroEl) {
    heroEl.style.setProperty('--liturgical-gradient', heroGradient);
    heroEl.style.setProperty('--liturgical-accent', heroPalette.accent);
    heroEl.style.setProperty('--liturgical-text', heroPalette.text);
  }

  container.querySelector('#voz-album-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });
  container
    .querySelector('#voz-create-btn')
    ?.addEventListener('click', () => navigate('/admin/voz/nueva'));

  // Click handlers + vars litúrgicas de cada portada mini
  container.querySelectorAll('[data-voz-id]').forEach((item) => {
    item.addEventListener('click', () => navigate(`/voz/${item.dataset.vozId}`));

    const word = words.find((w) => String(w.id) === item.dataset.vozId);
    if (!word) return;
    const pal = liturgicalPalette(word.liturgical_color);
    const cover = item.querySelector('.voz-album__cover');
    if (cover) {
      cover.style.setProperty('--liturgical-gradient', coverGradient(pal));
      cover.style.setProperty('--liturgical-accent', pal.accent);
    }
  });
}
