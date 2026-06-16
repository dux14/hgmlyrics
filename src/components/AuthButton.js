/**
 * AuthButton.js — Header button showing avatar + dropdown.
 */
import { getProfile, signOut, subscribe, isAdmin } from '../lib/authStore.js';
import { navigate, getCurrentPath } from '../router.js';
import { icon } from '../lib/icons.js';
import { getPendingIncomingCount, onPendingChanged } from '../lib/friends.js';
import { escapeHtml } from '../lib/escape.js';
import { isFounder, founderCrownHtml } from '../lib/founders.js';

function defaultAvatarUrl(displayName) {
  const initial = (displayName || '?').trim().charAt(0).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>
    <rect width='28' height='28' fill='#0097a7'/>
    <text x='14' y='19' text-anchor='middle' font-family='sans-serif' font-size='14' fill='white'>${initial}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

export function buildButton(profile, pendingCount = 0) {
  const avatarUrl =
    profile?.avatarUrl || defaultAvatarUrl(profile?.displayName || profile?.username);
  const dot = pendingCount > 0 ? '<span class="auth-button__dot" aria-hidden="true"></span>' : '';
  const crown = isFounder(profile?.username) ? founderCrownHtml() : '';
  return `
    <button class="auth-button" id="auth-button" aria-label="Menú de usuario${pendingCount > 0 ? ' (tienes solicitudes pendientes)' : ''}">
      <span>${escapeHtml(profile?.displayName || profile?.username || '')}</span>
      <span class="auth-button__avatar-wrap">
        <img class="auth-button__avatar" src="${escapeHtml(avatarUrl)}" alt="" />${dot}${crown}
      </span>
    </button>
  `;
}

export function buildMenu(currentPath = '/', pendingCount = 0) {
  const norm = (currentPath || '/').split('?')[0];
  const item = (href, ic, label, extra = '') => {
    const active = norm === href.slice(1) ? ' aria-current="page"' : '';
    return `<a class="auth-menu__item" href="${href}"${active}>${icon(ic, { size: 16 })} ${label}${extra}</a>`;
  };
  const beta = '<span class="badge--beta">BETA</span>';
  const dot = pendingCount > 0 ? '<span class="auth-menu__dot" aria-hidden="true"></span>' : '';
  const adminItem = isAdmin()
    ? `<div class="auth-menu__sep" role="separator"></div>${item('#/admin', 'settings', 'Admin')}`
    : '';
  return `
    <div class="auth-menu" id="auth-menu" role="menu">
      ${item('#/perfil', 'user', 'Perfil')}
      ${item('#/favoritos', 'heart', 'Favoritos')}
      ${item('#/amigos', 'users', 'Amigos', dot)}
      <div class="auth-menu__sep" role="separator"></div>
      ${item('#/afinador', 'audio-lines', 'Afinador', beta)}
      ${item('#/recomendador', 'sparkles', 'Recomendador', beta)}
      ${item('#/estudio', 'layers', 'Estudio', beta)}
      ${adminItem}
      <div class="auth-menu__sep" role="separator"></div>
      <button class="auth-menu__item auth-menu__item--danger" id="logout-btn">${icon('log-out', { size: 16 })} Cerrar sesión</button>
    </div>
  `;
}

/**
 * Render the auth button + dropdown into the given mount.
 * @param {HTMLElement} mount
 */
export function renderAuthButton(mount) {
  let pendingCount = 0;

  function update() {
    const profile = getProfile();
    if (!profile) {
      mount.innerHTML = '';
      return;
    }
    mount.innerHTML = buildButton(profile, pendingCount);
    wireButton();
  }

  function refreshPending() {
    getPendingIncomingCount().then((n) => {
      if (n !== pendingCount) {
        pendingCount = n;
        update();
      }
    });
  }

  function wireButton() {
    const btn = mount.querySelector('#auth-button');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      let menu = document.querySelector('#auth-menu');
      if (menu) {
        menu.remove();
        return;
      }
      document.body.insertAdjacentHTML('beforeend', buildMenu(getCurrentPath(), pendingCount));
      menu = document.querySelector('#auth-menu');

      const reposition = () => {
        const rect = btn.getBoundingClientRect();
        const rightOffset = Math.max(8, document.documentElement.clientWidth - rect.right);
        menu.style.right = `${rightOffset}px`;
        menu.style.top = `${rect.bottom + 6}px`;
      };
      reposition();
      window.addEventListener('resize', reposition);
      window.addEventListener('scroll', reposition, { passive: true });

      const cleanup = () => {
        window.removeEventListener('resize', reposition);
        window.removeEventListener('scroll', reposition);
        menu.remove();
      };

      menu.querySelector('#logout-btn').addEventListener('click', async () => {
        try {
          // auth-js puede devolver { error } sin lanzar (fallo de red) y dejar la
          // sesión local viva: lo registramos, pero la salida no depende de él.
          const result = await signOut();
          if (result?.error) console.error('signOut falló', result.error);
        } catch (err) {
          // signOut también puede lanzar (timeout del navigator-lock, red).
          console.error('signOut falló', err);
        } finally {
          // La salida visual ocurre SIEMPRE; replace evita dejar la ruta
          // protegida en el history (back-trap).
          cleanup();
          navigate('/login', { replace: true });
        }
      });
      // Close on outside click
      setTimeout(() => {
        const close = (ev) => {
          if (!menu.contains(ev.target) && ev.target !== btn) {
            cleanup();
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
    });
  }

  update();
  subscribe(update);
  refreshPending();
  onPendingChanged((n) => {
    pendingCount = n;
    update();
  });
}
