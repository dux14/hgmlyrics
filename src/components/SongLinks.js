/**
 * SongLinks.js — Song link tracker page
 *
 * Displays platform links (YouTube, Spotify, etc.) and voice Drive links
 * for a given song. Public page, no auth required to view.
 */

import '../styles/song-links.css';
import { fetchSongDetail } from '../lib/store.js';
import { navigate } from '../router.js';
import { VOICE_TYPES, getVoiceColor } from '../lib/voiceSystem.js';
import { isAdmin } from '../lib/authStore.js';

const API_URL = '/api';

const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', color: '#FF0000' },
  { id: 'spotify', label: 'Spotify', color: '#1DB954' },
  { id: 'apple_music', label: 'Apple Music', color: '#FA243C' },
  { id: 'deezer', label: 'Deezer', color: '#A238FF' },
  { id: 'amazon_music', label: 'Amazon Music', color: '#25D1DA' },
  { id: 'tidal', label: 'Tidal', color: '#000000' },
  { id: 'soundcloud', label: 'SoundCloud', color: '#FF5500' },
];

const PLATFORM_ICONS = {
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/></svg>`,
  spotify: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.98-1.38-.48.12-.96-.12-1.08-.6s.12-.96.6-1.08c4.38-1.32 9.78-.66 13.5 1.62.36.18.54.78.22 1.14zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.14-.18-1.32-.72-.18-.6.18-1.14.72-1.32 4.26-1.26 11.28-.96 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-.96.6-1.5.24h-.12z"/></svg>`,
  apple_music: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.99 6.84a5.2 5.2 0 0 0-.15-1.2 3.58 3.58 0 0 0-1.27-1.9 3.54 3.54 0 0 0-1.3-.7 5.27 5.27 0 0 0-1.2-.15c-.47-.02-.63-.03-1.85-.03h-12.4c-1.22 0-1.38.01-1.86.03a5.27 5.27 0 0 0-1.2.15 3.49 3.49 0 0 0-1.3.7 3.58 3.58 0 0 0-1.27 1.9 5.2 5.2 0 0 0-.15 1.2C.02 7.31.01 7.47.01 8.7v6.6c0 1.22.01 1.38.03 1.86.02.41.06.82.15 1.2a3.58 3.58 0 0 0 1.27 1.9c.38.31.82.55 1.3.7.39.1.79.13 1.2.15.47.02.63.03 1.86.03h12.4c1.22 0 1.38-.01 1.86-.03.41-.02.82-.06 1.2-.15a3.58 3.58 0 0 0 2.57-2.6c.1-.39.13-.79.15-1.2.02-.48.03-.64.03-1.86v-6.6c0-1.22-.01-1.38-.03-1.86zM16.95 14.38c0 .78-.06 1.17-.17 1.5a2.3 2.3 0 0 1-.93 1.17c-.4.26-.83.43-1.29.44-.36.01-.63-.04-.88-.16a1.56 1.56 0 0 1-.72-.7 1.84 1.84 0 0 1-.18-.97c.02-.42.14-.76.38-1.04.24-.27.56-.47.93-.58l1.39-.42c.19-.06.29-.18.29-.35V9.49c0-.14-.05-.24-.16-.3-.1-.05-.23-.04-.35.03L10.6 10.7c-.12.04-.18.14-.18.3v5c0 .78-.06 1.17-.17 1.5a2.3 2.3 0 0 1-.93 1.17c-.4.26-.83.43-1.29.44-.36.01-.63-.04-.88-.16a1.56 1.56 0 0 1-.72-.7 1.84 1.84 0 0 1-.18-.97c.02-.42.14-.76.38-1.04.24-.27.56-.47.93-.58l1.39-.42c.19-.06.29-.18.29-.35V8.36c0-.32.1-.56.3-.72.2-.15.45-.24.78-.3l5.24-1.13c.33-.07.57-.02.74.14.17.16.26.42.26.77v7.26z"/></svg>`,
  deezer: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="0" y="18" width="4" height="2" rx=".5"/><rect x="5" y="18" width="4" height="2" rx=".5"/><rect x="5" y="15" width="4" height="2" rx=".5"/><rect x="10" y="18" width="4" height="2" rx=".5"/><rect x="10" y="15" width="4" height="2" rx=".5"/><rect x="10" y="12" width="4" height="2" rx=".5"/><rect x="15" y="18" width="4" height="2" rx=".5"/><rect x="15" y="15" width="4" height="2" rx=".5"/><rect x="15" y="12" width="4" height="2" rx=".5"/><rect x="15" y="9" width="4" height="2" rx=".5"/><rect x="20" y="18" width="4" height="2" rx=".5"/><rect x="20" y="15" width="4" height="2" rx=".5"/><rect x="20" y="12" width="4" height="2" rx=".5"/><rect x="20" y="9" width="4" height="2" rx=".5"/><rect x="20" y="6" width="4" height="2" rx=".5"/></svg>`,
  amazon_music: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.77 20.68c-3.38 2.03-8.33 3.11-12.56 3.11-5.94 0-11.29-2.2-15.34-5.85-.32-.29-.03-.68.35-.46 4.37 2.54 9.77 4.07 15.35 4.07 3.76 0 7.9-.78 11.71-2.4.57-.25 1.06.38.49.53z" transform="translate(4.5,-1)"/><path d="M19.17 19.06c-.43-.55-2.86-.26-3.95-.13-.33.04-.38-.25-.08-.46 1.93-1.36 5.11-.97 5.48-.51.37.46-.1 3.65-1.91 5.17-.28.23-.55.11-.42-.2.41-1.02 1.31-3.32.88-3.87z" transform="translate(4.5,-1)"/><path d="M15.34 4.07V1.59c0-.37.28-.63.63-.63h11.08c.36 0 .64.26.64.63v2.12c0 .36-.3.83-.84 1.56l-5.74 8.2c2.13-.05 4.38.27 6.31 1.35.43.24.55.6.58.95v2.65c0 .36-.4.78-.81.56-3.39-1.78-7.9-1.97-11.65.02-.38.2-.78-.2-.78-.57v-2.52c0-.4.01-1.08.41-1.69l6.65-9.55h-5.79c-.36 0-.64-.26-.64-.63v.03z" transform="translate(-7,-1)"/></svg>`,
  tidal: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4L8 8l4 4-4 4-4-4 4-4-4-4 4-4zm4 0l4 4-4 4-4-4z" transform="translate(0,2)"/></svg>`,
  soundcloud: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.175 12.225c-.05 0-.1.037-.1.075l-.35 2.45.35 2.4c0 .05.05.075.1.075s.1-.025.1-.075l.4-2.4-.4-2.45c0-.05-.05-.075-.1-.075zm-.85.8c-.05 0-.075.025-.075.075l-.275 1.65.275 1.6c0 .05.025.075.075.075s.075-.025.075-.075l.3-1.6-.3-1.65c0-.05-.025-.075-.075-.075zm1.7-1.2c-.075 0-.125.05-.125.1l-.35 2.875.35 2.775c0 .075.05.125.125.125s.125-.05.125-.125l.4-2.775-.4-2.875c0-.075-.05-.1-.125-.1zm.85-.4c-.075 0-.15.05-.15.125l-.35 3.275.35 3.125c0 .075.075.15.15.15s.15-.075.15-.15l.375-3.125-.375-3.275c0-.075-.075-.125-.15-.125zm.85-.3c-.1 0-.175.075-.175.175l-.325 3.575.325 3.325c0 .1.075.175.175.175s.175-.075.175-.175l.35-3.325-.35-3.575c0-.1-.075-.175-.175-.175zm.9-.25c-.1 0-.2.075-.2.2l-.3 3.8.3 3.425c0 .1.1.2.2.2s.2-.1.2-.2l.325-3.425-.325-3.8c0-.125-.1-.2-.2-.2zm.875-.3c-.125 0-.225.1-.225.225l-.275 4.075.275 3.45c0 .125.1.225.225.225s.225-.1.225-.225l.3-3.45-.3-4.075c0-.125-.1-.225-.225-.225zm.925-.15c-.125 0-.25.1-.25.25l-.25 4.2.25 3.475c.025.125.125.225.25.225s.225-.1.25-.225l.275-3.475-.275-4.2c-.025-.15-.125-.25-.25-.25zm.95.025c-.15 0-.275.125-.275.275l-.225 3.95.225 3.475c0 .15.125.275.275.275s.275-.125.275-.275l.25-3.475-.25-3.95c0-.15-.125-.275-.275-.275zm.925-.175c-.15 0-.3.125-.3.3l-.2 4.1.2 3.475c0 .175.15.3.3.3s.3-.125.3-.3l.225-3.475-.225-4.1c0-.175-.15-.3-.3-.3zm2.875-1.825c-.2 0-.35.15-.35.35l-.2 5.575.2 3.425c0 .2.15.35.35.35s.35-.15.35-.35l.225-3.425-.225-5.575c0-.2-.15-.35-.35-.35zm-.925.475c-.175 0-.325.15-.325.325L9 16.5l.2 3.45c0 .175.15.325.325.325s.325-.15.325-.325l.225-3.45-.225-5.1c0-.175-.15-.325-.325-.325zm1.85-1.075c-.2 0-.375.175-.375.375L15 16.5l.175 3.4c0 .2.175.375.375.375s.375-.175.375-.375l.2-3.4-.2-6.3c0-.2-.175-.375-.375-.375zm.95-.225c-.225 0-.4.175-.4.4l-.15 6.075.15 3.35c0 .225.175.4.4.4s.4-.175.4-.4l.175-3.35-.175-6.075c0-.225-.175-.4-.4-.4zm.925-.1c-.225 0-.425.2-.425.425L18 16.5l.15 3.3c0 .225.2.425.425.425s.425-.2.425-.425l.175-3.3-.175-6.95c-.025-.225-.2-.425-.425-.425zm3.85 2.225a2.93 2.93 0 0 0-1.225.275c-.25-2.85-2.65-5.075-5.6-5.075-.75 0-1.475.15-2.1.45-.25.1-.3.2-.3.4v10.375c0 .2.15.375.35.4h8.875a2.9 2.9 0 0 0 2.9-2.9 2.9 2.9 0 0 0-2.9-2.925z"/></svg>`,
};

const DRIVE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.71 3.5L1.15 15l3.43 6 6.56-11.5zm1.14 0l6.56 11.5H22.l-6.56-11.5zm7.42 12.5H2.57L6 22h13.72z" opacity=".85"/></svg>`;

/**
 * @param {HTMLElement} container
 * @param {string} songId
 */
export async function renderSongLinks(container, songId) {
  container.innerHTML = `
    <div class="empty-state fade-in">
      <div class="empty-state__icon">⏳</div>
      <h2 class="empty-state__title">Cargando...</h2>
    </div>
  `;

  const [song, linksRes] = await Promise.all([
    fetchSongDetail(songId).catch(() => null),
    fetch(`${API_URL}/songs/${songId}/links`)
      .then((r) => (r.ok ? r.json() : { platforms: [], voices: [] }))
      .catch(() => ({ platforms: [], voices: [] })),
  ]);

  if (!song) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">😕</div>
        <h2 class="empty-state__title">Canción no encontrada</h2>
        <button class="btn btn--primary" style="margin-top:1rem" id="links-go-home">Volver</button>
      </div>
    `;
    container.querySelector('#links-go-home')?.addEventListener('click', () => navigate('/'));
    return;
  }

  const { platforms, voices } = linksRes;

  const coverUrl = song.coverImage
    ? song.coverImage.startsWith('/') || song.coverImage.startsWith('http')
      ? song.coverImage
      : `/covers/${song.coverImage}`
    : '';

  const hasPlatforms = platforms.length > 0;
  const hasVoices = voices.length > 0;
  const isEmpty = !hasPlatforms && !hasVoices;

  const platformCardsHtml = platforms
    .map((link) => {
      const meta = PLATFORMS.find((p) => p.id === link.platform);
      if (!meta) return '';
      const icon = PLATFORM_ICONS[link.platform] || '';
      return `
        <a class="slinks-platform-card" href="${escapeAttr(link.url)}" target="_blank" rel="noopener" style="--platform-color: ${meta.color}">
          <span class="slinks-platform-card__icon">${icon}</span>
          <span class="slinks-platform-card__label">${escapeHtml(meta.label)}</span>
        </a>
      `;
    })
    .join('');

  const voiceGroupsMap = {};
  for (const v of voices) {
    if (!voiceGroupsMap[v.voiceType]) voiceGroupsMap[v.voiceType] = [];
    voiceGroupsMap[v.voiceType].push(v);
  }

  const voiceCardsHtml = VOICE_TYPES.filter((vt) => voiceGroupsMap[vt.id])
    .map((vt) => {
      const links = voiceGroupsMap[vt.id];
      const linksHtml = links
        .map(
          (l) => `
          <a class="slinks-voice-link" href="${escapeAttr(l.url)}" target="_blank" rel="noopener">
            <span class="slinks-voice-link__icon">${DRIVE_ICON}</span>
            <span class="slinks-voice-link__text">${escapeHtml(l.label || 'Partitura')}</span>
          </a>
        `,
        )
        .join('');
      return `
        <div class="slinks-voice-card" style="--voice-color: ${getVoiceColor(vt.id)}">
          <div class="slinks-voice-card__header">
            <span class="slinks-voice-card__dot"></span>
            <span class="slinks-voice-card__name">${escapeHtml(vt.label)}</span>
          </div>
          <div class="slinks-voice-card__links">${linksHtml}</div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="slinks fade-in">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/" id="slinks-home">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <a href="#/song/${escapeAttr(songId)}" id="slinks-song">${escapeHtml(song.title)}</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">Links</span>
      </nav>

      <div class="slinks__header">
        ${coverUrl ? `<img class="slinks__cover" src="${coverUrl}" alt="" onerror="this.style.display='none'" />` : ''}
        <div class="slinks__meta">
          <h1 class="slinks__title">${escapeHtml(song.title)}</h1>
          <p class="slinks__artist">${escapeHtml(song.artist || '')} — ${escapeHtml(song.album || '')}</p>
          <p class="slinks__year">${song.year || ''} ${song.genre ? `· ${song.genre}` : ''} ${song.key ? `· ${song.key}` : ''}</p>
        </div>
      </div>

      ${
        isEmpty
          ? `
        <div class="slinks__empty">
          <p>No hay links disponibles para esta canción.</p>
          ${isAdmin() ? `<a href="#/admin/edit/${escapeAttr(songId)}" class="btn btn--primary" style="margin-top:1rem">Agregar links</a>` : ''}
        </div>
      `
          : ''
      }

      ${
        hasPlatforms
          ? `
        <section class="slinks__section">
          <h2 class="slinks__section-title">Escuchar en</h2>
          <div class="slinks-platforms">${platformCardsHtml}</div>
        </section>
      `
          : ''
      }

      ${
        hasVoices
          ? `
        <section class="slinks__section">
          <h2 class="slinks__section-title">Voces</h2>
          <div class="slinks-voices">${voiceCardsHtml}</div>
        </section>
      `
          : ''
      }

      ${isAdmin() && !isEmpty ? `<div class="slinks__admin"><a href="#/admin/edit/${escapeAttr(songId)}" class="btn btn--secondary">Editar links</a></div>` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
