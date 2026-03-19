/**
 * AdminGate.js — PIN authentication gate
 *
 * Displays a PIN input form. On successful authentication,
 * renders the song editor.
 */

import { login, isAuthenticated, logout } from '../lib/auth.js';
import { navigate } from '../router.js';

/**
 * Render the admin gate
 * @param {HTMLElement} container
 * @param {Function} onAuthenticated - Called when auth succeeds
 */
export function renderAdminGate(container, onAuthenticated) {
  // If already authenticated, skip gate
  if (isAuthenticated()) {
    onAuthenticated();
    return;
  }

  container.innerHTML = `
    <div class="admin-gate fade-in">
      <div class="admin-gate__card">
        <div class="admin-gate__icon">🔐</div>
        <h2 class="admin-gate__title">Admin</h2>
        <p class="admin-gate__subtitle">Introduce el PIN para acceder al panel de administración</p>
        <form id="admin-form">
          <input
            type="password"
            class="admin-gate__input"
            id="pin-input"
            placeholder="••••"
            maxlength="20"
            autocomplete="off"
            inputmode="numeric"
          />
          <div class="admin-gate__error" id="pin-error"></div>
          <button type="submit" class="admin-gate__submit" id="admin-submit">Acceder</button>
        </form>
        <button
          style="margin-top: 1rem; font-size: 0.8rem; color: var(--color-text-secondary);"
          id="admin-back"
        >
          ← Volver al inicio
        </button>
      </div>
    </div>
  `;

  const form = container.querySelector('#admin-form');
  const pinInput = container.querySelector('#pin-input');
  const pinError = container.querySelector('#pin-error');
  const submitBtn = container.querySelector('#admin-submit');

  // Auto-focus
  setTimeout(() => pinInput.focus(), 100);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();

    if (!pin) {
      pinError.textContent = 'Introduce un PIN';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verificando...';
    pinError.textContent = '';

    const success = await login(pin);

    if (success) {
      onAuthenticated();
    } else {
      pinError.textContent = 'PIN incorrecto';
      pinInput.classList.add('admin-gate__input--error');
      pinInput.value = '';
      pinInput.focus();
      submitBtn.disabled = false;
      submitBtn.textContent = 'Acceder';

      setTimeout(() => {
        pinInput.classList.remove('admin-gate__input--error');
      }, 400);
    }
  });

  container.querySelector('#admin-back').addEventListener('click', () => {
    navigate('/');
  });
}

/**
 * Render admin logout button
 * @param {HTMLElement} container
 */
export function renderLogoutButton(container) {
  const btn = document.createElement('button');
  btn.className = 'btn btn--secondary';
  btn.textContent = '🚪 Cerrar sesión';
  btn.style.marginBottom = '1rem';

  btn.addEventListener('click', () => {
    logout();
    navigate('/admin');
  });

  container.prepend(btn);
}
