// src/components/VoicesAlbumView.js
// Vista virtual del álbum "Voces en off": tracklist de semanas, badge VIGENTE,
// estado vacío, acceso al detalle de cada voz.

import { navigate } from '../router.js';
import { isAdmin } from '../lib/authStore.js';
import { liturgicalPalette, coverGradient } from '../lib/liturgicalColor.js';
import { escapeHtml } from '../lib/escape.js';
import { supabase } from '../lib/supabase.js';

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
      <div class="empty-state__icon">🕊</div>
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
      <div class="empty-state fade-in" style="padding: 3rem 1rem; text-align: center;">
        <div style="font-size: 3rem;">🕊</div>
        <h2 class="empty-state__title">Aún no hay voces en off</h2>
        <p class="empty-state__text">Cada domingo se publica una reflexión sobre el evangelio.</p>
        ${isAdmin() ? `<button class="btn btn--primary" id="voz-create-btn" style="margin-top: 1rem;">Crear voz en off</button>` : ''}
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
    <div class="voz-album fade-in" style="max-width: 680px; margin: 0 auto; padding: 1.5rem 1rem;">

      <!-- Breadcrumb -->
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/" id="voz-album-home">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">Voces en off</span>
      </nav>

      <!-- Hero portada álbum -->
      <div class="voz-album__hero" style="background: ${heroGradient}; border-radius: var(--border-radius-lg); padding: 2.5rem 1.5rem; margin: 1rem 0 1.5rem; color: ${heroPalette.text}; text-align: center;">
        <div style="font-size: 3.5rem; margin-bottom: 0.5rem;">🕊</div>
        <h1 style="font-size: 1.6rem; font-weight: 700; margin: 0 0 0.25rem; color: inherit;">Voces en off</h1>
        <p style="margin: 0; opacity: 0.8; font-size: 0.9rem;">${words.length} entrada${words.length !== 1 ? 's' : ''}</p>
        ${isAdmin() ? `<button class="btn btn--sm" id="voz-create-btn" style="margin-top: 1rem;">+ Nueva voz en off</button>` : ''}
      </div>

      <!-- Tracklist -->
      <ul class="voz-album__list" style="list-style: none; padding: 0; margin: 0;">
        ${words
          .map((w) => {
            const palette = liturgicalPalette(w.liturgical_color);
            const isVig = w.id === vigenteId;
            return `
          <li class="voz-album__item" data-voz-id="${escapeHtml(w.id)}" style="display: flex; align-items: center; gap: 1rem; padding: 0.875rem 0.75rem; border-radius: var(--border-radius); cursor: pointer; border-bottom: 1px solid var(--color-border);">
            <!-- Mini portada generativa -->
            <div style="width: 48px; height: 48px; flex-shrink: 0; border-radius: 8px; background: ${coverGradient(palette)}; display: flex; align-items: center; justify-content: center; font-size: 1.4rem;">🕊</div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(w.gospel_ref)}</div>
              <div style="font-size: 0.8rem; color: var(--color-text-secondary);">${escapeHtml(formatShortDate(w.sunday_date))}</div>
            </div>
            ${isVig ? `<span style="background: #2d7a4f; color: #fff; border-radius: 999px; padding: 0.15em 0.6em; font-size: 0.7rem; font-weight: 700; white-space: nowrap;">VIGENTE</span>` : ''}
          </li>`;
          })
          .join('')}
      </ul>
    </div>
  `;

  container.querySelector('#voz-album-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });
  container
    .querySelector('#voz-create-btn')
    ?.addEventListener('click', () => navigate('/admin/voz/nueva'));

  container.querySelectorAll('[data-voz-id]').forEach((item) => {
    item.addEventListener('click', () => navigate(`/voz/${item.dataset.vozId}`));
  });
}
