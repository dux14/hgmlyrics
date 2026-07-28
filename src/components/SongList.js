/**
 * SongList.js — Song card component
 *
 * Crea la card de canción (carátula, título, badge de voz, favorito) usada
 * por Home.js. El grid/lista con toggle de vista, la fila de lista y el
 * skeleton viejos se eliminaron: sin usuarios tras el rediseño de Home.
 */

import { navigate } from '../router.js';
import { isPWA, isSongCached } from '../lib/offlineCache.js';
import { isAuthenticated } from '../lib/authStore.js';
import { isFavorite, toggleFavorite } from '../lib/favorites.js';
import { icon, COVER_PLACEHOLDER } from '../lib/icons.js';
import { resolveCoverUrl, voiceBadge } from './songRow.js';
import { escapeHtml } from '../lib/escape.js';

function paintFavBtn(btn, on) {
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Quitar de favoritos' : 'Agregar a favoritos');
  const path = btn.querySelector('path');
  if (path) path.setAttribute('fill', on ? 'currentColor' : 'none');
}

/**
 * Create a song card element
 * @param {object} song
 * @param {number} index - For staggered animation
 * @returns {HTMLElement}
 */
export function createSongCard(song, index) {
  const card = document.createElement('article');
  card.className = 'song-card fade-in';
  card.style.animationDelay = `${index * 50}ms`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${song.title} — ${song.album}`);

  const { class: voiceBadgeClass, label: voiceLabel } = voiceBadge(song);
  const coverUrl = resolveCoverUrl(song);

  // First card above the fold is the LCP candidate: load eagerly + high priority.
  const isLCP = index === 0;
  const imgLoading = isLCP ? 'eager' : 'lazy';
  const imgFetchPriority = isLCP ? 'high' : 'auto';

  const showFavBtn = isAuthenticated();
  const favOn = showFavBtn && isFavorite(song.id);

  card.innerHTML = `
    <div class="song-card__cover-wrap">
      <img
        class="song-card__cover"
        src="${coverUrl}"
        alt="Portada de ${escapeHtml(song.album)}"
        width="400"
        height="400"
        loading="${imgLoading}"
        decoding="async"
        fetchpriority="${imgFetchPriority}"
        onerror="this.src='${COVER_PLACEHOLDER}'"
      />
      ${
        showFavBtn
          ? `<button class="song-card__fav ${favOn ? 'is-on' : ''}" type="button" aria-label="${favOn ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-pressed="${favOn}">
               <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9C1 8.5 3 5 6.5 5c2 0 3.5 1.2 4.5 2.7C12 6.2 13.5 5 15.5 5 19 5 21 8.5 21.5 12c-2 4.4-9.5 9-9.5 9z" fill="${favOn ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
             </button>`
          : ''
      }
    </div>
    <div class="song-card__info">
      <h3 class="song-card__title">${escapeHtml(song.title)}</h3>
      <p class="song-card__album">${escapeHtml(song.album)} · ${song.year || ''}</p>
      <div class="song-card__meta">
        <span class="voice-badge ${voiceBadgeClass}">${voiceLabel}</span>
        <div class="voice-bar" style="width: 60px;" title="${song.voicePercent?.male || 0}% masc. / ${song.voicePercent?.female || 0}% fem.">
          <div class="voice-bar__male" style="width: ${song.voicePercent?.male || 50}%"></div>
          <div class="voice-bar__female" style="width: ${song.voicePercent?.female || 50}%"></div>
        </div>
      </div>
    </div>
  `;

  // Navigation click
  card.addEventListener('click', () => {
    navigate(`/song/${song.id}`);
  });

  // Keyboard accessibility
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(`/song/${song.id}`);
    }
  });

  // Favorite toggle (intercept before card click).
  const favBtn = card.querySelector('.song-card__fav');
  if (favBtn) {
    favBtn.dataset.songId = song.id;
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      favBtn.disabled = true;
      const nowFav = await toggleFavorite(song.id);
      favBtn.disabled = false;
      paintFavBtn(favBtn, nowFav);
    });
  }

  // F8: Offline badge in PWA mode
  if (isPWA()) {
    isSongCached(song.id).then((cached) => {
      if (cached) {
        const badge = document.createElement('span');
        badge.className = 'offline-badge';
        badge.innerHTML = `${icon('check', { size: 13 })} Offline`;
        card.querySelector('.song-card__meta')?.appendChild(badge);
      }
    });
  }

  return card;
}
