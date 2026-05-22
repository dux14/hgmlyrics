/**
 * PublicProfile.js — /u/:username (lectura, dentro del login wall).
 */
import { getSession } from '../lib/authStore.js';

async function fetchProfile(username) {
  const token = getSession()?.access_token;
  const res = await fetch(`/api/profile/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

/**
 * Render the public profile.
 * @param {HTMLElement} container
 * @param {string} username
 */
export async function renderPublicProfile(container, username) {
  container.innerHTML = '<div class="profile-page"><p>Cargando...</p></div>';
  const data = await fetchProfile(username);
  if (!data) {
    container.innerHTML = `
      <div class="profile-page">
        <h2>Perfil no encontrado</h2>
        <p>El perfil no existe o no es visible.</p>
        <a class="auth-link" href="#/">Volver al inicio</a>
      </div>
    `;
    return;
  }

  const { profile, favorites, friendCount, isOwn } = data;
  const avatar = profile.avatarUrl || '';

  container.innerHTML = `
    <div class="profile-page fade-in">
      <div class="profile-header">
        ${avatar ? `<img class="profile-avatar" src="${avatar}" alt="" />` : `<div class="profile-avatar"></div>`}
        <div>
          <h1>${escapeHtml(profile.displayName || profile.username)}</h1>
          <div class="profile-username">@${escapeHtml(profile.username)}</div>
          <div class="profile-username">${friendCount} amigo${friendCount === 1 ? '' : 's'}</div>
        </div>
      </div>

      ${profile.bio ? `<div class="profile-section"><p>${escapeHtml(profile.bio)}</p></div>` : ''}

      <div class="profile-section">
        <h2 class="profile-section__title">Voz</h2>
        <p>${escapeHtml(profile.voiceType || '—')}${profile.voiceSubtype ? ` (${escapeHtml(profile.voiceSubtype)})` : ''}</p>
        <p>Rango: ${escapeHtml(profile.vocalRangeLow || '—')} – ${escapeHtml(profile.vocalRangeHigh || '—')}</p>
        ${profile.vocalRangeNotes ? `<p class="profile-username">${escapeHtml(profile.vocalRangeNotes)}</p>` : ''}
      </div>

      ${
        profile.instrumentRoles?.length
          ? `
        <div class="profile-section">
          <h2 class="profile-section__title">Instrumentos</h2>
          <div class="profile-tags">
            ${profile.instrumentRoles.map((i) => `<span class="profile-tag">${escapeHtml(i)}</span>`).join('')}
          </div>
        </div>
      `
          : ''
      }

      <div class="profile-section">
        <h2 class="profile-section__title">Favoritas (${favorites.length})</h2>
        ${
          favorites.length === 0
            ? '<p>—</p>'
            : `
          <ul class="friends-list">
            ${favorites
              .map(
                (f) => `
              <li class="friend-item">
                <span>${escapeHtml(f.title)}</span>
                <span style="color: var(--color-text-secondary);">${escapeHtml(f.album || '')}</span>
              </li>
            `,
              )
              .join('')}
          </ul>
        `
        }
      </div>

      ${isOwn ? '<a class="auth-link" href="#/perfil">Editar mi perfil</a>' : ''}
    </div>
  `;
}
