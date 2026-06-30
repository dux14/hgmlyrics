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
 * Pantalla de edición de perfil (Task 3).
 * Mismo flujo que el form original; solo cambia markup + clases (pf-*).
 * @param {HTMLElement} container
 */
export async function renderProfileEdit(container) {
  const profile = getProfile();
  if (!profile) {
    container.innerHTML = '<div class="profile-page"><p>Cargando...</p></div>';
    return;
  }

  const avatarUrl = profile.avatarUrl || '';

  container.innerHTML = `
    <div class="profile-page fade-in">
      <div class="pf-etop">
        <a class="pf-bk" href="#/perfil" aria-label="Volver">${icon('chevron-left', { size: 16 })}</a>
        <h1>Editar perfil</h1>
        <span class="pf-saved" id="form-success" style="display:none">${icon('check', { size: 12 })}Guardado</span>
      </div>

      <div class="pf-av-edit">
        <div class="pf-av-lg">
          <img class="pf-av" id="avatar-preview" src="${escapeHtml(avatarUrl)}" alt="Avatar" />
          <span class="pf-cam">${icon('camera', { size: 12 })}</span>
        </div>
        <div class="pf-ava">
          <button class="pf-ab" type="button" id="avatar-btn">Cambiar avatar</button>
          <button class="pf-ab rm" type="button" id="avatar-remove-btn"
                  style="display:${isCustomAvatar(profile.avatarUrl) ? 'flex' : 'none'}">Eliminar</button>
        </div>
      </div>
      <input type="file" id="avatar-input" accept="image/*" style="display:none" />
      <p class="pf-av-note" id="avatar-error" style="display:none"></p>
      <p class="pf-av-note">WEBP, PNG o JPEG &middot; hasta 2&nbsp;MB (se comprime).</p>

      <form class="pf-form" id="profile-form">
        <div class="pf-fld">
          <div class="pf-fl"><span>Nombre a mostrar</span></div>
          <input class="pf-inp" id="display-input" type="text"
                 value="${escapeHtml(profile.displayName || '')}" maxlength="60" />
        </div>
        <div class="pf-two">
          <div class="pf-fld">
            <div class="pf-fl">Tipo de voz</div>
            <select class="pf-inp" id="voice-type-input">
              ${VOICE_TYPES.map(
                ([v, l]) =>
                  `<option value="${escapeHtml(v)}"${profile.voiceType === v ? ' selected' : ''}>${escapeHtml(l)}</option>`,
              ).join('')}
            </select>
          </div>
          <div class="pf-fld">
            <div class="pf-fl">Subtipo de voz</div>
            <select class="pf-inp" id="voice-subtype-input">
              ${VOICE_SUBTYPES.map(
                ([v, l]) =>
                  `<option value="${escapeHtml(v)}"${profile.voiceSubtype === v ? ' selected' : ''}>${escapeHtml(l)}</option>`,
              ).join('')}
            </select>
          </div>
        </div>
        <div class="pf-fld">
          <div class="pf-fl"><span>Biografía</span></div>
          <textarea class="pf-inp pf-inp--area" id="bio-input"
                    rows="3" maxlength="400">${escapeHtml(profile.bio || '')}</textarea>
        </div>
        <div class="pf-fld">
          <div class="pf-fl">Instrumentos</div>
          <input class="pf-inp" id="instruments-input" type="text"
                 value="${escapeHtml((profile.instrumentRoles || []).join(', '))}" />
          <p class="pf-hint">Separa con comas. Aparecen como chips en tu perfil.</p>
        </div>
        <div class="pf-two">
          <div class="pf-fld">
            <div class="pf-fl">Rango vocal bajo</div>
            <input class="pf-inp" id="range-low-input" type="text"
                   value="${escapeHtml(profile.vocalRangeLow || '')}" placeholder="Ej. C3" />
          </div>
          <div class="pf-fld">
            <div class="pf-fl">Rango vocal alto</div>
            <input class="pf-inp" id="range-high-input" type="text"
                   value="${escapeHtml(profile.vocalRangeHigh || '')}" placeholder="Ej. A5" />
          </div>
        </div>
        <div class="pf-fld">
          <div class="pf-fl">Notas del rango</div>
          <input class="pf-inp" id="range-notes-input" type="text"
                 value="${escapeHtml(profile.vocalRangeNotes || '')}" />
        </div>
        <div class="pf-fld">
          <a class="pf-linkrow" href="#/afinador?mode=range">
            <span class="pf-li">${icon('activity', { size: 15 })}</span>
            <div class="pf-lt">
              <div class="pf-lt-a">Medir mi rango con el afinador</div>
              <div class="pf-lt-b">Abre el afinador en modo rango</div>
            </div>
            ${icon('chevron-right', { size: 15, className: 'pf-li-arr' })}
          </a>
        </div>
        <div class="pf-fld" style="margin-bottom:14px">
          <div class="pf-linkrow">
            <span class="pf-li pf-li--eye">${icon('eye', { size: 15 })}</span>
            <div class="pf-lt">
              <div class="pf-lt-a">Perfil público</div>
              <div class="pf-lt-b">Otros pueden verte y agregarte</div>
            </div>
            <label class="pf-sw">
              <input type="checkbox" id="public-input"${profile.isPublic ? ' checked' : ''}
                     style="position:absolute;opacity:0;pointer-events:none;width:0;height:0" />
            </label>
          </div>
        </div>
        <div id="form-error" style="display:none;color:var(--color-error);font-size:12px;padding:4px 0;"></div>
      </form>

      <div class="pf-actbar">
        <a class="pf-btn-ghost" href="#/perfil">Cancelar</a>
        <button class="pf-btn-pri" type="submit" form="profile-form" id="submit-btn">
          ${icon('check', { size: 15 })}Guardar
        </button>
      </div>
    </div>
  `;

  // Listeners (lógica idéntica al original; solo cambia markup/clases)
  const avatarBtn = container.querySelector('#avatar-btn');
  const avatarRemoveBtn = container.querySelector('#avatar-remove-btn');
  const avatarInput = container.querySelector('#avatar-input');
  const avatarPreview = container.querySelector('#avatar-preview');
  const avatarError = container.querySelector('#avatar-error');

  avatarBtn.addEventListener('click', () => avatarInput.click());
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    avatarError.textContent = 'Procesando imagen…';
    avatarError.style.color = 'var(--color-text-muted, #888)';
    avatarError.style.display = 'block';
    avatarBtn.disabled = true;
    try {
      const prepared = await compressImageToLimit(file);
      if (prepared.size > 2 * 1024 * 1024) {
        avatarError.textContent =
          'No pudimos reducir la imagen por debajo de 2 MB. Intenta con otra foto.';
        avatarError.style.color = '';
        return;
      }
      const url = await uploadAvatar(prepared);
      await refreshProfile();
      avatarPreview.src = url;
      avatarRemoveBtn.style.display = 'flex';
      avatarError.style.display = 'none';
      avatarError.style.color = '';
    } catch (e) {
      avatarError.textContent = `Error: ${e.message}`;
      avatarError.style.color = '';
      avatarError.style.display = 'block';
    } finally {
      avatarBtn.disabled = false;
    }
  });

  avatarRemoveBtn.addEventListener('click', async () => {
    avatarError.style.display = 'none';
    avatarRemoveBtn.disabled = true;
    try {
      const url = await deleteAvatar();
      await refreshProfile();
      avatarPreview.src = url || '';
      avatarRemoveBtn.style.display = 'none';
    } catch (e) {
      avatarError.textContent = `Error: ${e.message}`;
      avatarError.style.display = 'block';
    } finally {
      avatarRemoveBtn.disabled = false;
    }
  });

  container.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = container.querySelector('#form-error');
    const okEl = container.querySelector('#form-success');
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    const payload = {
      displayName: container.querySelector('#display-input').value.trim(),
      bio: container.querySelector('#bio-input').value.trim() || null,
      voiceType: container.querySelector('#voice-type-input').value || null,
      voiceSubtype: container.querySelector('#voice-subtype-input').value || null,
      vocalRangeLow: container.querySelector('#range-low-input').value.trim() || null,
      vocalRangeHigh: container.querySelector('#range-high-input').value.trim() || null,
      vocalRangeNotes: container.querySelector('#range-notes-input').value.trim() || null,
      instrumentRoles: container
        .querySelector('#instruments-input')
        .value.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      isPublic: container.querySelector('#public-input').checked,
    };
    const submitBtn = container.querySelector('#submit-btn');
    submitBtn.disabled = true;
    try {
      const { ok, data } = await patchProfile(payload);
      if (!ok) {
        errEl.textContent = data?.details?.join(', ') || data?.error || 'Error al guardar';
        errEl.style.display = 'block';
        return;
      }
      await refreshProfile();
      okEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
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
