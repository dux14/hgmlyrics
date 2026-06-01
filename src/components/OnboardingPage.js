/**
 * OnboardingPage.js — Pide username + display_name después del primer signup.
 * Bloquea avance hasta que ambos sean válidos.
 */
import { getSession, refreshProfile } from '../lib/authStore.js';
import { navigate } from '../router.js';

let usernameCheckTimer = null;

async function checkUsername(value) {
  const token = getSession()?.access_token;
  if (!token) return { available: false, reason: 'no_session' };
  const res = await fetch('/api/profile/check-username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username: value }),
  });
  if (!res.ok) return { available: false, reason: 'request_failed' };
  return res.json();
}

async function patchProfile(payload) {
  const token = getSession()?.access_token;
  const res = await fetch('/api/profile/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, data: await res.json().catch(() => null) };
}

/**
 * Render onboarding form.
 * @param {HTMLElement} container
 */
export function renderOnboardingPage(container) {
  container.innerHTML = `
    <div class="auth-page fade-in">
      <div class="auth-card">
        <h1 class="auth-title">¡Bienvenido!</h1>
        <p class="auth-subtitle">Elige un nombre de usuario y cómo quieres que te vean los demás.</p>

        <form id="onboarding-form" autocomplete="off">
          <label class="profile-field__label" for="username-input">Username (3–24 chars, a-z 0-9 _)</label>
          <input
            type="text"
            class="auth-input"
            id="username-input"
            maxlength="24"
            required
            inputmode="text"
            autocapitalize="off"
            spellcheck="false"
          />
          <div class="auth-hint" id="username-hint">Solo minúsculas, números y guion bajo.</div>
          <div class="auth-error" id="username-error" style="display:none;"></div>
          <div class="auth-success" id="username-success" style="display:none;"></div>

          <label class="profile-field__label" for="display-input">Nombre a mostrar</label>
          <input type="text" class="auth-input" id="display-input" maxlength="32" required />

          <button type="submit" class="auth-btn" id="submit-btn" disabled>Continuar</button>
        </form>
      </div>
    </div>
  `;

  const usernameInput = container.querySelector('#username-input');
  const displayInput = container.querySelector('#display-input');
  const submitBtn = container.querySelector('#submit-btn');
  const errEl = container.querySelector('#username-error');
  const okEl = container.querySelector('#username-success');

  let usernameOk = false;

  function updateSubmitEnabled() {
    submitBtn.disabled = !(usernameOk && displayInput.value.trim().length > 0);
  }

  usernameInput.addEventListener('input', () => {
    const raw = usernameInput.value.trim().toLowerCase();
    usernameInput.value = raw;
    usernameOk = false;
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    updateSubmitEnabled();
    clearTimeout(usernameCheckTimer);

    if (raw.length < 3) return;

    usernameCheckTimer = setTimeout(async () => {
      const r = await checkUsername(raw);
      if (r.available) {
        usernameOk = true;
        usernameInput.classList.remove('auth-input--error');
        usernameInput.classList.add('auth-input--success');
        okEl.textContent = 'Disponible';
        okEl.style.display = 'block';
      } else {
        usernameInput.classList.remove('auth-input--success');
        usernameInput.classList.add('auth-input--error');
        const reasons = {
          invalid_format: 'Formato inválido (3–24 chars, a-z 0-9 _)',
          reserved: 'Ese nombre está reservado.',
          taken: 'Ya está en uso.',
          request_failed: 'No se pudo verificar. Reintenta.',
        };
        errEl.textContent = reasons[r.reason] || 'No disponible';
        errEl.style.display = 'block';
      }
      updateSubmitEnabled();
    }, 350);
  });

  displayInput.addEventListener('input', updateSubmitEnabled);

  container.querySelector('#onboarding-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    const { ok, data } = await patchProfile({
      username: usernameInput.value.trim().toLowerCase(),
      displayName: displayInput.value.trim(),
    });

    if (!ok) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continuar';
      errEl.textContent =
        data?.error === 'username_taken'
          ? 'Ese username fue tomado mientras escribías.'
          : data?.details?.join(', ') || 'Error al guardar';
      errEl.style.display = 'block';
      return;
    }

    await refreshProfile();
    navigate('/');
  });
}
