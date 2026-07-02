/**
 * PublicProfile.js — /u/:username (lectura, dentro del login wall).
 */
import { getSession } from '../lib/authStore.js';
import { escapeHtml } from '../lib/escape.js';
import { isFounder, founderCrownHtml } from '../lib/founders.js';
import { icon, COVER_PLACEHOLDER } from '../lib/icons.js';
import '../styles/profile.css';
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelProfile } from '../lib/skeleton.js';
import { createWaveRange } from './vocal-range/waveRange.js';

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

async function removeFriend(otherUserId) {
  const token = getSession()?.access_token;
  const res = await fetch('/api/social/friends', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ otherUserId }),
  });
  return res.ok;
}

async function acceptFriend(requesterId) {
  const token = getSession()?.access_token;
  const res = await fetch('/api/social/friends', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ requesterId, action: 'accept' }),
  });
  return res.ok;
}

/**
 * Render the public profile.
 * @param {HTMLElement} container
 * @param {string} username
 */
export async function renderPublicProfile(container, username) {
  // Shell + región async (sin caché previa: perfil público siempre se carga fresco).
  container.innerHTML = `<div class="pp__region" aria-busy="true"></div>`;
  const region = container.querySelector('.pp__region');

  renderAsyncRegion(region, {
    skeleton: () => skelProfile(),
    fetcher: () => fetchProfile(username),
    render: (data) => {
      const { profile, favorites, friendCount, isOwn, friendStatus } = data;
      const displayName = escapeHtml(profile.displayName || profile.username);
      const avatar = profile.avatarUrl || '';
      const crown = isFounder(profile.username) ? founderCrownHtml() : '';

      // Distintivo de voz (solo si hay voiceType)
      const voiceType = profile.voiceType ? profile.voiceType.toLowerCase() : '';
      const voiceBadge = voiceType
        ? `<div class="pf-vbadge pf-vbadge--${escapeHtml(voiceType)}">
            <span class="pf-dot"></span>${escapeHtml(profile.voiceType)}${profile.voiceSubtype ? ` · ${escapeHtml(profile.voiceSubtype)}` : ''}
          </div>`
        : '';

      // Bio y chips dentro del bloque de identidad (coincide con mockup "Público")
      const bioHtml = profile.bio
        ? `<p class="pf-bio">${escapeHtml(profile.bio)}</p>`
        : '';
      const chipsHtml = profile.instrumentRoles?.length
        ? `<div class="pf-chips pf-chips--pub">
             ${profile.instrumentRoles.map((r) => `<span class="pf-chip">${escapeHtml(r)}</span>`).join('')}
           </div>`
        : '';

      // Botón de acción según estado de amistad, o enlace de edición si es perfil propio
      let actionHtml;
      if (isOwn) {
        actionHtml = `<a class="pf-edit-btn" href="#/perfil/editar">Editar mi perfil</a>`;
      } else if (friendStatus === 'accepted') {
        actionHtml = `<button class="pf-btn-action pf-btn-action--rm" id="rm-friend-btn">${icon('user-minus', { size: 16 })} Eliminar amigo</button>`;
      } else if (friendStatus === 'pending_out') {
        actionHtml = `<button class="pf-btn-action pf-btn-action--sent" id="add-friend-btn" disabled>${icon('clock', { size: 16 })} Solicitud enviada</button>`;
      } else if (friendStatus === 'pending_in') {
        actionHtml = `<button class="pf-btn-action pf-btn-action--in" id="accept-friend-btn">${icon('user-check', { size: 16 })} Aceptar solicitud</button>`;
      } else {
        // 'none' o sin estado conocido
        actionHtml = `<button class="pf-btn-action" id="add-friend-btn">${icon('user-plus', { size: 16 })} Agregar amigo</button>`;
      }

      // Tarjeta de rango vocal con host para la onda animada
      const hasRange = profile.vocalRangeLow || profile.vocalRangeHigh;
      const rangeLblHtml = hasRange
        ? `<div class="pf-range-lbl">
             <span class="lo"><span class="pf-dot"></span><b>${escapeHtml(profile.vocalRangeLow || '?')}</b> grave</span>
             <span class="hi">agudo <b>${escapeHtml(profile.vocalRangeHigh || '?')}</b><span class="pf-dot"></span></span>
           </div>`
        : '';
      const rangeCardHtml = hasRange
        ? `<div class="pf-card">
             <div class="pf-ctop"><span class="pf-cl">Rango vocal</span></div>
             <div class="pf-wave-host"></div>
             ${rangeLblHtml}
           </div>`
        : '';

      // Filas de favoritas
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

      region.innerHTML = `
        <div class="profile-page fade-in">
          <div class="pf-top">
            <div class="pf-amb"></div>
            <span class="avatar-wrap">
              ${avatar ? `<img class="pf-av" src="${escapeHtml(avatar)}" alt="" />` : `<div class="pf-av"></div>`}${crown}
            </span>
            <div class="pf-name">${displayName}</div>
            <div class="pf-user">@${escapeHtml(profile.username)} · ${friendCount} amigo${friendCount === 1 ? '' : 's'}</div>
            ${voiceBadge}
            ${bioHtml}
            ${chipsHtml}
          </div>

          ${actionHtml}

          ${rangeCardHtml}

          <div class="sec-h">Favoritas</div>
          <div class="pf-list">
            ${favRowsHtml}
          </div>
        </div>
      `;

      // Fallback de carátulas via JS (evita inline onerror en atributo HTML)
      region.querySelectorAll('img.pf-cv').forEach((img) => {
        img.onerror = () => { img.src = COVER_PLACEHOLDER; };
      });

      // Montar onda de rango tras setear innerHTML
      const waveHost = region.querySelector('.pf-wave-host');
      if (waveHost && hasRange) {
        const w = createWaveRange({ low: profile.vocalRangeLow, high: profile.vocalRangeHigh });
        if (w) waveHost.appendChild(w.el);
      }

      // Cablear botón "Agregar amigo" (estado none)
      const addBtn = region.querySelector('#add-friend-btn:not([disabled])');
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

      // Cablear botón "Eliminar amigo" (estado accepted)
      const rmBtn = region.querySelector('#rm-friend-btn');
      if (rmBtn) {
        rmBtn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar a este amigo?')) return;
          rmBtn.disabled = true;
          try {
            const ok = await removeFriend(profile.id);
            if (ok) {
              rmBtn.textContent = 'Eliminado';
              rmBtn.classList.add('pf-btn-action--sent');
            } else {
              rmBtn.textContent = 'No se pudo eliminar';
              rmBtn.disabled = false;
            }
          } catch {
            rmBtn.textContent = 'No se pudo eliminar';
            rmBtn.disabled = false;
          }
        });
      }

      // Cablear botón "Aceptar solicitud" (estado pending_in)
      const acceptBtn = region.querySelector('#accept-friend-btn');
      if (acceptBtn) {
        acceptBtn.addEventListener('click', async () => {
          acceptBtn.disabled = true;
          try {
            const ok = await acceptFriend(profile.id);
            if (ok) {
              acceptBtn.textContent = 'Solicitud aceptada';
              acceptBtn.classList.add('pf-btn-action--sent');
            } else {
              acceptBtn.textContent = 'No se pudo aceptar';
              acceptBtn.disabled = false;
            }
          } catch {
            acceptBtn.textContent = 'No se pudo aceptar';
            acceptBtn.disabled = false;
          }
        });
      }
    },
    empty: () => `
      <div class="profile-page">
        <h2>Perfil no encontrado</h2>
        <p>El perfil no existe o no es visible.</p>
        <a class="auth-link" href="#/">Volver al inicio</a>
      </div>`,
    onError: () => `
      <div class="empty-state">
        <h2 class="empty-state__title">No se pudo cargar el perfil</h2>
        <button class="btn btn--primary" data-retry>Reintentar</button>
      </div>`,
  });
}
