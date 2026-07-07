import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  signInWithGoogle: vi.fn(),
  signInWithMagicLink: vi.fn(),
  verifyEmailOtp: vi.fn(),
}));

vi.mock('../lib/icons.js', () => ({
  icon: vi.fn(() => ''),
}));

vi.mock('../router.js', () => ({
  navigate: vi.fn(),
}));

import { renderLoginPage } from './LoginPage.js';
import { signInWithMagicLink, verifyEmailOtp } from '../lib/authStore.js';
import { navigate } from '../router.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="c"></div>';
  vi.stubGlobal('navigator', { onLine: true });
  vi.clearAllMocks();
  globalThis.location.hash = '#/login';
});

describe('renderLoginPage — branding Ambient Kinetic', () => {
  it('incluye el logo HKN y el título de inicio de sesión', () => {
    const c = document.querySelector('#c');
    renderLoginPage(c);
    expect(c.querySelector('.auth-logo')).not.toBeNull();
    expect(c.querySelector('.auth-title').textContent).toContain('Inicia sesión');
  });
});

async function sendMagicLink(container, email = 'ana@correo.com') {
  signInWithMagicLink.mockResolvedValue({ error: null });
  container.querySelector('#email-input').value = email;
  container.querySelector('#magic-form').dispatchEvent(new Event('submit'));
  // Deja correr los microtasks del handler async.
  await Promise.resolve();
  await Promise.resolve();
}

describe('login con código OTP', () => {
  it('tras enviar el enlace muestra el campo de código', async () => {
    const c = document.querySelector('#c');
    renderLoginPage(c);

    await sendMagicLink(c);

    expect(c.querySelector('#otp-input')).not.toBeNull();
    expect(c.querySelector('#otp-btn')).not.toBeNull();
  });

  it('código correcto navega a home cuando no hay next', async () => {
    const c = document.querySelector('#c');
    renderLoginPage(c);
    await sendMagicLink(c);

    verifyEmailOtp.mockResolvedValue({ data: { session: {} }, error: null });
    c.querySelector('#otp-input').value = '12345678';
    c.querySelector('#otp-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();
    await Promise.resolve();

    expect(verifyEmailOtp).toHaveBeenCalledWith('ana@correo.com', '12345678');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('respeta un next seguro en el query del hash', async () => {
    globalThis.location.hash = '#/login?next=%2Fperfil';
    const c = document.querySelector('#c');
    renderLoginPage(c);
    await sendMagicLink(c);

    verifyEmailOtp.mockResolvedValue({ data: { session: {} }, error: null });
    c.querySelector('#otp-input').value = '12345678';
    c.querySelector('#otp-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledWith('/perfil');
  });

  it('ignora un next malicioso (open redirect)', async () => {
    globalThis.location.hash = '#/login?next=%2F%2Fevil.com';
    const c = document.querySelector('#c');
    renderLoginPage(c);
    await sendMagicLink(c);

    verifyEmailOtp.mockResolvedValue({ data: { session: {} }, error: null });
    c.querySelector('#otp-input').value = '12345678';
    c.querySelector('#otp-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('código incorrecto muestra el error y rehabilita el botón', async () => {
    const c = document.querySelector('#c');
    renderLoginPage(c);
    await sendMagicLink(c);

    verifyEmailOtp.mockResolvedValue({
      data: { session: null },
      error: { message: 'Código inválido' },
    });
    const otpBtn = c.querySelector('#otp-btn');
    c.querySelector('#otp-input').value = '00000000';
    c.querySelector('#otp-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();
    await Promise.resolve();

    expect(navigate).not.toHaveBeenCalled();
    const errEl = c.querySelector('#email-error');
    expect(errEl.textContent).toContain('Código inválido');
    expect(errEl.style.display).not.toBe('none');
    expect(otpBtn.disabled).toBe(false);
  });
});
