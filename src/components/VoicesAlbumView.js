// src/components/VoicesAlbumView.js
// Vista virtual del álbum "Voces en off": tracklist de semanas, badge VIGENTE,
// estado vacío, acceso al detalle de cada voz.

import '../styles/voices.css';
import { navigate } from '../router.js';
import { isAdmin } from '../lib/authStore.js';
import { liturgicalPalette, coverGradient } from '../lib/liturgicalColor.js';
import { escapeHtml } from '../lib/escape.js';
import { icon } from '../lib/icons.js';
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelTracklist } from '../lib/skeleton.js';
import { voiceoverHero } from '../lib/voiceoverHero.js';
import { getWeeklyWords } from '../lib/weeklyWords.js';

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

function bindVozEvents(region, words) {
  region.querySelectorAll('[data-voz-id]').forEach((item) => {
    const word = words.find((w) => String(w.id) === item.dataset.vozId);
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-voz]')) return;
      navigate(`/voz/${item.dataset.vozId}`);
    });
    if (!word) return;
    const pal = liturgicalPalette(word.liturgical_color);
    const cover = item.querySelector('.voz-album__cover');
    if (cover) {
      cover.style.setProperty('--liturgical-gradient', coverGradient(pal));
      cover.style.setProperty('--liturgical-accent', pal.accent);
    }
  });
  region.querySelectorAll('[data-edit-voz]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate(`/admin/voz/${btn.dataset.editVoz}`);
    });
  });
}

/**
 * Renderiza la vista del álbum "Voces en off".
 * @param {HTMLElement} container
 */
export async function renderVoicesAlbumView(container) {
  // Shell instantáneo: hero estático + región async para meta+tracklist.
  container.innerHTML = `
    <div class="voz-album page--headerless fade-in">
      <div class="voz-album__hero">
        <div class="voz-album__hero-icon">${icon('gospel', { size: 48 })}</div>
        <h1 class="voz-album__hero-title">Voces en off</h1>
      </div>
      <div class="voz-album__region" aria-busy="true"></div>
    </div>
  `;
  const region = container.querySelector('.voz-album__region');

  const fetcher = () => getWeeklyWords();

  const paintList = (words) => {
    const today = new Date().toISOString().slice(0, 10);
    const vigenteId = words.find((w) => isVigente(w.sunday_date, today))?.id ?? null;

    // Colorea el hero con la paleta litúrgica de la voz vigente (si no hay
    // vigente, cae a la primera) y devuelve el meta + botón de crear a su
    // lugar dentro del banner.
    const hero = container.querySelector('.voz-album__hero');
    if (hero) {
      const vigenteWord = words.find((w) => w.id === vigenteId) ?? words[0];
      const pal = liturgicalPalette(vigenteWord?.liturgical_color);
      hero.style.setProperty('--liturgical-gradient', coverGradient(pal));
      hero.style.setProperty('--liturgical-accent', pal.accent);
      hero.style.setProperty('--liturgical-text', pal.text);
      hero.innerHTML = `
        <p class="voz-album__hero-kicker">Palabra de la semana</p>
        <div class="voz-album__hero-icon">${icon('gospel', { size: 48 })}</div>
        <h1 class="voz-album__hero-title">Voces en off</h1>
        <p class="voz-album__hero-meta">${words.length} entrada${words.length !== 1 ? 's' : ''}</p>
        ${isAdmin() ? `<button class="btn btn--primary btn--sm" id="voz-create-btn">+ Nueva voz en off</button>` : ''}
      `;
    }

    region.innerHTML = `
      <ul class="voz-album__list">
        ${words
          .map((w) => {
            const isVig = w.id === vigenteId;
            const title = voiceoverHero(w).bigTitle || w.gospel_ref;
            const sub = [formatShortDate(w.sunday_date), w.gospel_ref].filter(Boolean).join(' · ');
            return `
          <li class="voz-album__item" data-voz-id="${escapeHtml(w.id)}">
            <div class="voz-album__cover">${icon('gospel', { size: 26 })}</div>
            <div class="voz-album__meta">
              <div class="voz-album__m-title">${escapeHtml(title)}</div>
              <div class="voz-album__m-sub">${escapeHtml(sub)}</div>
            </div>
            ${isVig ? `<span class="voz-album__badge--vigente">VIGENTE</span>` : ''}
            ${isAdmin() ? `<button class="voz-album__edit" data-edit-voz="${escapeHtml(w.id)}" aria-label="Editar voz en off">${icon('pencil', { size: 18 })}</button>` : ''}
          </li>`;
          })
          .join('')}
      </ul>
    `;
    bindVozEvents(region, words);
  };

  renderAsyncRegion(region, {
    skeleton: () => skelTracklist({ rows: 4 }),
    fetcher,
    render: paintList,
    empty: () => `
      <div class="empty-state">
        <div class="empty-state__icon">${icon('gospel', { size: 40 })}</div>
        <h2 class="empty-state__title">Aún no hay voces en off</h2>
        <p class="empty-state__text">Cada domingo se publica una reflexión sobre el evangelio.</p>
        ${isAdmin() ? `<button class="btn btn--primary" id="voz-create-btn">Crear voz en off</button>` : ''}
      </div>`,
    onError: () => `
      <div class="empty-state">
        <h2 class="empty-state__title">No se pudieron cargar las voces</h2>
        <button class="btn btn--primary" data-retry>Reintentar</button>
      </div>`,
  });

  container.addEventListener('click', (e) => {
    if (e.target.closest('#voz-create-btn')) navigate('/admin/voz/nueva');
  });
}
