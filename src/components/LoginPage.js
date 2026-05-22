/**
 * LoginPage.js — Public login page.
 * Renders Google OAuth button + email magic link form.
 * Detects offline and shows a fallback message.
 */
import { signInWithGoogle, signInWithMagicLink } from '../lib/authStore.js';

const GOOGLE_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
</svg>`;

function offlinePane(container) {
  container.innerHTML = `
    <div class="auth-page fade-in">
      <div class="auth-card auth-offline">
        <div style="font-size:48px;">📡</div>
        <h2 class="auth-title">Sin conexión</h2>
        <p class="auth-subtitle">Necesitas conexión para iniciar sesión.</p>
        <button class="auth-btn" id="retry-btn">Reintentar</button>
      </div>
    </div>
  `;
  const retry = container.querySelector('#retry-btn');
  retry.addEventListener('click', () => render(container));
  const onOnline = () => {
    globalThis.removeEventListener('online', onOnline);
    render(container);
  };
  globalThis.addEventListener('online', onOnline);
}

function render(container, opts = {}) {
  if (!navigator.onLine) {
    offlinePane(container);
    return;
  }

  const isRegister = opts.mode === 'register';
  const title = isRegister ? 'Crea tu cuenta' : 'Inicia sesión';
  const subtitle = isRegister
    ? 'Regístrate con Google o con tu correo.'
    : 'Continúa con Google o con tu correo.';
  const switchLabel = isRegister
    ? '¿Ya tienes cuenta? Inicia sesión'
    : '¿No tienes cuenta? Regístrate';
  const switchHash = isRegister ? '#/login' : '#/register';

  container.innerHTML = `
    <div class="auth-page fade-in">
      <div class="auth-card">
        <h1 class="auth-title">${title}</h1>
        <p class="auth-subtitle">${subtitle}</p>

        <button class="auth-btn auth-btn--google" id="google-btn">
          ${GOOGLE_ICON_SVG}
          <span>Continuar con Google</span>
        </button>

        <div class="auth-divider"><span>o</span></div>

        <form id="magic-form" autocomplete="off">
          <input
            type="email"
            class="auth-input"
            id="email-input"
            placeholder="tu@correo.com"
            required
            autocomplete="email"
            inputmode="email"
          />
          <div class="auth-error" id="email-error" style="display:none;"></div>
          <div class="auth-success" id="email-success" style="display:none;"></div>
          <button type="submit" class="auth-btn" id="magic-btn">
            Enviar enlace mágico
          </button>
        </form>

        <a href="${switchHash}" class="auth-link">${switchLabel}</a>
      </div>
    </div>
  `;

  container.querySelector('#google-btn').addEventListener('click', async () => {
    const { error } = await signInWithGoogle();
    if (error) {
      const el = container.querySelector('#email-error');
      el.textContent = `Error de Google: ${error.message}`;
      el.style.display = 'block';
    }
  });

  container.querySelector('#magic-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = container.querySelector('#email-input').value.trim();
    const errEl = container.querySelector('#email-error');
    const okEl = container.querySelector('#email-success');
    const btn = container.querySelector('#magic-btn');
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const { error } = await signInWithMagicLink(email);
    btn.disabled = false;
    btn.textContent = 'Enviar enlace mágico';

    if (error) {
      errEl.textContent = error.message;
      errEl.style.display = 'block';
    } else {
      okEl.textContent = 'Listo. Revisa tu correo para iniciar sesión.';
      okEl.style.display = 'block';
    }
  });
}

/**
 * Render the login page.
 * @param {HTMLElement} container
 */
export function renderLoginPage(container) {
  render(container, { mode: 'login' });
}

/**
 * Render the register page (same form, different copy).
 * @param {HTMLElement} container
 */
export function renderRegisterPage(container) {
  render(container, { mode: 'register' });
}
