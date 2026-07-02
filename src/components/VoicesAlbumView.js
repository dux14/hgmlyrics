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
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelTracklist } from '../lib/skeleton.js';

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
    <div class="voz-album fade-in">
      <div class="voz-album__hero">
        <div class="voz-album__hero-icon">${icon('gospel', { size: 48 })}</div>
        <h1 class="voz-album__hero-title">Voces en off</h1>
      </div>
      <div class="voz-album__region" aria-busy="true"></div>
    </div>
  `;
  const region = container.querySelector('.voz-album__region');

  const fetcher = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch('/api/weekly-words', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('weekly-words fetch failed');
    const body = await res.json();
    return body.weeklyWords ?? [];
  };

  const paintList = (words) => {
    const today = new Date().toISOString().slice(0, 10);
    const vigenteId = words.find((w) => isVigente(w.sunday_date, today))?.id ?? null;

    // Colorea el hero con la paleta litúrgica de la voz más reciente (como en
    // master) y devuelve el meta + botón de crear a su lugar dentro del banner.
    const hero = container.querySelector('.voz-album__hero');
    if (hero) {
      const pal = liturgicalPalette(words[0]?.liturgical_color);
      hero.style.setProperty('--liturgical-gradient', coverGradient(pal));
      hero.style.setProperty('--liturgical-accent', pal.accent);
      hero.style.setProperty('--liturgical-text', pal.text);
      hero.innerHTML = `
        <div class="voz-album__hero-icon">${icon('gospel', { size: 48 })}</div>
        <h1 class="voz-album__hero-title">Voces en off</h1>
        <p class="voz-album__hero-meta">${words.length} entrada${words.length !== 1 ? 's' : ''}</p>
        ${isAdmin() ? `<button class="btn btn--sm" id="voz-create-btn">+ Nueva voz en off</button>` : ''}
      `;
    }

    region.innerHTML = `
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
