/**
 * Profile.js — Own profile view + edit + avatar upload.
 */
import { getSession, getProfile, refreshProfile } from '../lib/authStore.js';
import { icon } from '../lib/icons.js';
import { compressImageToLimit } from '../lib/imageCompress.js';

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
 * Render the profile page (own profile editor).
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
      <div class="profile-header">
        <img class="profile-avatar" id="avatar-preview" src="${profile.avatarUrl || ''}" alt="Avatar" />
        <div>
          <h1>${profile.displayName || profile.username}</h1>
          <div class="profile-username">@${profile.username}</div>
        </div>
      </div>

      <div style="display:flex; gap:var(--space-sm); flex-wrap:wrap; margin-bottom:var(--space-lg);">
        <a class="auth-btn" href="#/favoritos" style="flex:1; min-width:160px; text-decoration:none; text-align:center;">${icon('heart', { size: 16, fill: true })} Mis favoritos</a>
        <a class="auth-btn" href="#/amigos" style="flex:1; min-width:160px; text-decoration:none; text-align:center;">Amigos</a>
        <a class="auth-btn" href="#/licencias" style="flex:1; min-width:160px; text-decoration:none; text-align:center;">Licencias y créditos</a>
      </div>

      <input type="file" id="avatar-input" accept="image/webp,image/png,image/jpeg" style="display:none;" />
      <div style="display:flex; gap:var(--space-sm); flex-wrap:wrap; max-width:480px;">
        <button class="auth-btn" id="avatar-btn" style="flex:1; min-width:160px;">Cambiar avatar</button>
        <button class="auth-btn" id="avatar-remove-btn" style="flex:1; min-width:160px; display:${isCustomAvatar(profile.avatarUrl) ? 'flex' : 'none'};">Eliminar avatar</button>
      </div>
      <div class="auth-error" id="avatar-error" style="display:none;"></div>

      <form id="profile-form" style="margin-top:var(--space-xl);">
        <div class="profile-field">
          <label class="profile-field__label" for="display-input">Nombre a mostrar</label>
          <input type="text" class="auth-input" id="display-input" maxlength="32" value="${profile.displayName || ''}" />
        </div>

        <div class="profile-field">
          <label class="profile-field__label" for="bio-input">Bio (≤200 chars)</label>
          <textarea class="auth-input" id="bio-input" maxlength="200" rows="3">${profile.bio || ''}</textarea>
        </div>

        <div class="profile-field">
          <label class="profile-field__label" for="voice-type-input">Tipo de voz</label>
          <select class="auth-input" id="voice-type-input">
            ${VOICE_TYPES.map(([v, l]) => `<option value="${v}" ${profile.voiceType === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>

        <div class="profile-field">
          <label class="profile-field__label" for="voice-subtype-input">Subtipo de voz</label>
          <select class="auth-input" id="voice-subtype-input">
            ${VOICE_SUBTYPES.map(([v, l]) => `<option value="${v}" ${profile.voiceSubtype === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>

        <div class="profile-field">
          <label class="profile-field__label" for="range-low-input">Rango vocal bajo (ej C3)</label>
          <input type="text" class="auth-input" id="range-low-input" maxlength="3" value="${profile.vocalRangeLow || ''}" />
        </div>

        <div class="profile-field">
          <label class="profile-field__label" for="range-high-input">Rango vocal alto (ej A5)</label>
          <input type="text" class="auth-input" id="range-high-input" maxlength="3" value="${profile.vocalRangeHigh || ''}" />
        </div>

        <div class="profile-field">
          <a class="auth-btn" href="#/afinador?mode=range" style="display:block; text-decoration:none; text-align:center;">
            ${icon('mic', { size: 16 })} Medir mi rango con el afinador
          </a>
        </div>

        <div class="profile-field">
          <label class="profile-field__label" for="range-notes-input">Notas del rango (opcional, ≤80 chars)</label>
          <input type="text" class="auth-input" id="range-notes-input" maxlength="80" placeholder="ej. falsete G4-D2, zona segura D2-D4" value="${(profile.vocalRangeNotes || '').replace(/"/g, '&quot;')}" />
        </div>

        <div class="profile-field">
          <label class="profile-field__label" for="instruments-input">Instrumentos (separados por coma)</label>
          <input type="text" class="auth-input" id="instruments-input" value="${(profile.instrumentRoles || []).join(', ')}" />
        </div>

        <div class="profile-field">
          <label class="profile-field__label">
            <input type="checkbox" id="public-input" ${profile.isPublic ? 'checked' : ''} />
            Perfil público (visible para otros usuarios autenticados)
          </label>
        </div>

        <div class="auth-error" id="form-error" style="display:none;"></div>
        <div class="auth-success" id="form-success" style="display:none;"></div>
        <button type="submit" class="auth-btn" id="submit-btn">Guardar</button>
      </form>
    </div>
  `;

  const avatarBtn = container.querySelector('#avatar-btn');
  const avatarRemoveBtn = container.querySelector('#avatar-remove-btn');
  const avatarInput = container.querySelector('#avatar-input');
  const avatarPreview = container.querySelector('#avatar-preview');
  const avatarError = container.querySelector('#avatar-error');

  avatarBtn.addEventListener('click', () => avatarInput.click());
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;

    // Show a neutral "processing" status (override the red error style temporarily).
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

    const { ok, data } = await patchProfile(payload);
    if (!ok) {
      errEl.textContent = data?.details?.join(', ') || data?.error || 'Error al guardar';
      errEl.style.display = 'block';
      return;
    }
    await refreshProfile();
    okEl.textContent = 'Guardado';
    okEl.style.display = 'block';
  });
}
