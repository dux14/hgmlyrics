/**
 * PublicProfile.js — /u/:username (lectura, dentro del login wall).
 */
import { getSession } from '../lib/authStore.js';
import { escapeHtml } from '../lib/escape.js';
import { isFounder, founderCrownHtml } from '../lib/founders.js';
import { icon, COVER_PLACEHOLDER } from '../lib/icons.js';
import '../styles/profile.css';

async function fetchProfile(username) {
  const token = getSession()?.access_token;
  const res = await fetch(`/api/profile/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function sendFriendRequest(username) {
  const token = getSession()?.access_token;
  const res = await fetch('/api/social/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username }),
  });
  return res.ok;
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
  const displayName = escapeHtml(profile.displayName || profile.username);
  const avatar = profile.avatarUrl || '';
  const crown = isFounder(profile.username) ? founderCrownHtml() : '';

  // Distintivo de voz (solo si hay voiceType; los modificadores CSS ya existen en profile.css)
  const voiceType = profile.voiceType ? profile.voiceType.toLowerCase() : '';
  const voiceBadge = voiceType
    ? `<div class="pf-vbadge pf-vbadge--${escapeHtml(voiceType)}">
        <span class="pf-dot"></span>${escapeHtml(profile.voiceType)}${profile.voiceSubtype ? ` · ${escapeHtml(profile.voiceSubtype)}` : ''}
      </div>`
    : '';

  // Botón de acción ámbar o enlace de edición (según isOwn)
  const actionHtml = !isOwn
    ? `<button class="pf-btn-action" id="add-friend-btn">${icon('user-plus', { size: 16 })} Agregar amigo</button>`
    : `<a class="pf-edit-btn" href="#/perfil/editar">Editar mi perfil</a>`;

  // Sección bio (solo si hay bio)
  const bioHtml = profile.bio
    ? `<div class="sec-h">Sobre ${displayName}</div>
       <p class="pf-bio">${escapeHtml(profile.bio)}</p>`
    : '';

  // Sección instrumentos (solo si hay)
  const instrumentsHtml = profile.instrumentRoles?.length
    ? `<div class="sec-h">Instrumentos</div>
       <div class="pf-chips pf-chips--pub">
         ${profile.instrumentRoles.map((r) => `<span class="pf-chip">${escapeHtml(r)}</span>`).join('')}
       </div>`
    : '';

  // Filas de favoritas — sin badge de voz (dato no disponible en el endpoint)
  const favRowsHtml =
    favorites.length === 0
      ? '<p class="pf-bio">—</p>'
      : favorites
          .map(
            (f) =>
              `<div class="pf-srow">
                <img class="pf-cv" src="${f.coverImage ? escapeHtml(f.coverImage) : COVER_PLACEHOLDER}" alt="" />
                <div class="pf-si">
                  <div class="pf-st">${escapeHtml(f.title)}</div>
                  <div class="pf-sa">${escapeHtml(f.album || '')}</div>
                </div>
              </div>`,
          )
          .join('');

  container.innerHTML = `
    <div class="profile-page fade-in">
      <div class="pf-top">
        <div class="pf-amb"></div>
        <span class="avatar-wrap">
          ${avatar ? `<img class="pf-av" src="${escapeHtml(avatar)}" alt="" />` : `<div class="pf-av"></div>`}${crown}
        </span>
        <div class="pf-name">${displayName}</div>
        <div class="pf-user">@${escapeHtml(profile.username)} · ${friendCount} amigo${friendCount === 1 ? '' : 's'}</div>
        ${voiceBadge}
      </div>

      ${actionHtml}

      ${bioHtml}

      ${instrumentsHtml}

      <div class="sec-h">Favoritas</div>
      <div class="pf-list">
        ${favRowsHtml}
      </div>
    </div>
  `;

  // Fallback de carátulas via JS (evita inline onerror en atributo HTML)
  container.querySelectorAll('img.pf-cv').forEach((img) => {
    img.onerror = () => {
      img.src = COVER_PLACEHOLDER;
    };
  });

  // Cablear botón "Agregar amigo"
  const addBtn = container.querySelector('#add-friend-btn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      addBtn.disabled = true;
      try {
        const ok = await sendFriendRequest(profile.username);
        if (ok) {
          addBtn.textContent = 'Solicitud enviada';
          addBtn.classList.add('pf-btn-action--sent');
          // queda deshabilitado a propósito tras éxito
        } else {
          addBtn.textContent = 'No se pudo enviar';
          addBtn.disabled = false; // permite reintentar
        }
      } catch {
        addBtn.textContent = 'No se pudo enviar';
        addBtn.disabled = false; // permite reintentar
      }
    });
  }
}
