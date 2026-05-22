/**
 * Profile.js — Own profile view + edit + avatar upload.
 */
import { getSession, getProfile, refreshProfile } from '../lib/authStore.js';
import { supabase } from '../lib/supabase.js';

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

async function uploadAvatar(userId, file) {
  const ext = (file.name.split('.').pop() || 'webp').toLowerCase();
  const path = `${userId}/avatar.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`; // cache-bust
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

      <input type="file" id="avatar-input" accept="image/webp,image/png,image/jpeg" style="display:none;" />
      <button class="auth-btn" id="avatar-btn" style="max-width:240px;">Cambiar avatar</button>
      <div class="auth-error" id="avatar-error" style="display:none;"></div>

      <form id="profile-form" style="margin-top:var(--space-xl);">
        <div class="profile-field">
          <label class="profile-field__label" for="display-input">Nombre a mostrar</label>
          <input type="text" class="auth-input" id="display-input" maxlength="80" value="${profile.displayName || ''}" />
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
  const avatarInput = container.querySelector('#avatar-input');
  const avatarPreview = container.querySelector('#avatar-preview');
  const avatarError = container.querySelector('#avatar-error');

  avatarBtn.addEventListener('click', () => avatarInput.click());
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    avatarError.style.display = 'none';
    if (file.size > 2 * 1024 * 1024) {
      avatarError.textContent = 'Máximo 2 MB';
      avatarError.style.display = 'block';
      return;
    }
    try {
      const url = await uploadAvatar(profile.id, file);
      await patchProfile({ avatarUrl: url });
      await refreshProfile();
      avatarPreview.src = url;
    } catch (e) {
      avatarError.textContent = `Error: ${e.message}`;
      avatarError.style.display = 'block';
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
    okEl.textContent = 'Guardado ✓';
    okEl.style.display = 'block';
  });
}
