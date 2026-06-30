/**
 * Profile.js — Own profile view + edit + avatar upload.
 */
import { getSession, getProfile, refreshProfile } from '../lib/authStore.js';
import { icon } from '../lib/icons.js';
import { compressImageToLimit } from '../lib/imageCompress.js'; // usados por renderProfileEdit (Task 3)
import { escapeHtml } from '../lib/escape.js';
import { isFounder, founderCrownHtml } from '../lib/founders.js';
import '../styles/profile.css';

const VOICE_TYPES = [
  ['', '—'],
  ['soprano', 'Soprano'],
  ['contralto', 'Contralto'],
  ['tenor', 'Tenor'],
  ['bass', 'Bajo'],
];
const VOICE_SUBTYPES = [
  ['', '—'],
  ['alta', 'Alta'],
  ['baja', 'Baja'],
];

const VOICE_LABELS = { soprano: 'Soprano', contralto: 'Contralto', tenor: 'Tenor', bass: 'Bajo' };

/** Barras decorativas del rango vocal (7; centrales activas, extremos grave/agudo). */
export function buildRangeBars() {
  const heights = ['38%', '54%', '72%', '90%', '75%', '58%', '36%'];
  return heights.map((h, i) => ({
    h,
    on: i >= 1 && i <= 5,
    lo: i === 1,
    hi: i === 5,
  }));
}

/** Etiqueta + clase de color de cuerda para la píldora de voz. null si no hay voz. */
export function voiceLabel(voiceType, voiceSubtype) {
  if (!voiceType || !VOICE_LABELS[voiceType]) return null;
  const sub = voiceSubtype
    ? ` ${voiceSubtype.charAt(0).toUpperCase()}${voiceSubtype.slice(1)}`
    : '';
  return { text: `${VOICE_LABELS[voiceType]}${sub}`, cls: `voice-pill--${voiceType}` };
}

/** Cabecera Ambient Kinetic: ambient blob + avatar + nombre + voz + rango + instrumentos + accesos. */
export function buildProfileHeader(profile) {
  const avatarUrl = profile.avatarUrl || '';
  const voice = voiceLabel(profile.voiceType, profile.voiceSubtype);
  const crown = isFounder(profile.username) ? founderCrownHtml() : '';
  const vbadge = voice
    ? `<div class="pf-vbadge pf-vbadge--${profile.voiceType}"><span class="pf-dot"></span>${voice.text}</div>`
    : '';
  const bio = profile.bio
    ? `<p class="pf-bio">${escapeHtml(profile.bio)}</p>`
    : '';
  const hasRange = profile.vocalRangeLow || profile.vocalRangeHigh;
  const bars = buildRangeBars()
    .map(
      (b) =>
        `<i class="${b.on ? 'on' : ''}${b.lo ? ' lo' : ''}${b.hi ? ' hi' : ''}" style="--h:${b.h}"></i>`,
    )
    .join('');
  const rangeCard = hasRange
    ? `<div class="pf-card">
         <div class="pf-row">
           <div class="pf-cl">Rango vocal</div>
           <a class="pf-edit-btn" href="#/perfil/editar">${icon('edit', { size: 11 })}Editar</a>
         </div>
         <div class="pf-range" aria-hidden="true">${bars}</div>
         <div class="pf-range-lbl">
           <span class="lo"><span class="pf-dot"></span>${escapeHtml(profile.vocalRangeLow || '?')} · grave</span>
           <span class="hi">${escapeHtml(profile.vocalRangeHigh || '?')} · agudo<span class="pf-dot"></span></span>
         </div>
       </div>`
    : '';
  const chips = (profile.instrumentRoles || []).filter(Boolean);
  const instrCard = chips.length
    ? `<div class="pf-card">
         <div class="pf-cl">Instrumentos</div>
         <div class="pf-chips">${chips.map((r) => `<span class="pf-chip">${escapeHtml(r)}</span>`).join('')}</div>
       </div>`
    : '';
  const favCount = Number.isFinite(profile.favoriteCount) ? profile.favoriteCount : '';
  const friendCount = Number.isFinite(profile.friendCount) ? profile.friendCount : '';
  return `
    <div class="pf-top">
      <div class="pf-amb" aria-hidden="true"></div>
      <span class="avatar-wrap">
        <img class="pf-av" id="avatar-preview" src="${escapeHtml(avatarUrl)}" alt="Avatar" />${crown}
      </span>
      <h1 class="pf-name">${escapeHtml(profile.displayName || profile.username)}</h1>
      <div class="pf-user">@${escapeHtml(profile.username)}</div>
      ${vbadge}
      ${bio}
    </div>
    ${rangeCard}
    ${instrCard}
    <div class="pf-acc">
      <a class="pf-accrow" href="#/amigos">
        <span class="pf-ai pf-ai--friends">${icon('user', { size: 16 })}</span>
        <span class="pf-an">Amigos</span><span class="pf-ac">${friendCount}</span>
        ${icon('chevron-right', { size: 15, className: 'pf-arr' })}
      </a>
      <a class="pf-accrow" href="#/favoritos">
        <span class="pf-ai pf-ai--fav">${icon('heart', { size: 16 })}</span>
        <span class="pf-an">Favoritos</span><span class="pf-ac">${favCount}</span>
        ${icon('chevron-right', { size: 15, className: 'pf-arr' })}
      </a>
    </div>
  `;
}

// Las funciones y constantes siguientes se reusarán en renderProfileEdit (Task 3).
async function patchProfile(payload) {
  const token = getSession()?.access_token;
  const res = await fetch('/api/profile/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, data: await res.json().catch(() => null) };
}

async function uploadAvatar(file) {
  const token = getSession()?.access_token;
  const fd = new FormData();
  fd.append('avatar', file, file.name);
  const res = await fetch('/api/profile/avatar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = data?.error || `HTTP ${res.status}`;
    throw new Error(reason);
  }
  return data.url;
}

async function deleteAvatar() {
  const token = getSession()?.access_token;
  const res = await fetch('/api/profile/avatar', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = data?.error || `HTTP ${res.status}`;
    throw new Error(reason);
  }
  return data.url;
}

function isCustomAvatar(url) {
  return !!url && /\/storage\/v\d+\/object\/public\/avatars\//.test(url);
}

/**
 * Render the profile page (vista de solo lectura).
 * El formulario de edición se mueve a renderProfileEdit (Task 3).
 * @param {HTMLElement} container
 */
export async function renderProfile(container) {
  const profile = getProfile();
  if (!profile) {
    container.innerHTML = '<div class="profile-page"><p>Cargando...</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="profile-page fade-in">
      ${buildProfileHeader(profile)}
      <a class="profile-licenses-link" href="#/licencias">Licencias y créditos</a>
    </div>
  `;
}
