/**
 * AuthButton.js — Header button showing avatar + dropdown.
 */
import { getProfile, signOut, subscribe } from '../lib/authStore.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';

function defaultAvatarUrl(displayName) {
  const initial = (displayName || '?').trim().charAt(0).toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>
    <rect width='28' height='28' fill='#0097a7'/>
    <text x='14' y='19' text-anchor='middle' font-family='sans-serif' font-size='14' fill='white'>${initial}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

function buildButton(profile) {
  const avatarUrl =
    profile?.avatarUrl || defaultAvatarUrl(profile?.displayName || profile?.username);
  return `
    <button class="auth-button" id="auth-button" aria-label="Menú de usuario">
      <span>${profile?.displayName || profile?.username || ''}</span>
      <img class="auth-button__avatar" src="${avatarUrl}" alt="" />
    </button>
  `;
}

function buildMenu() {
  return `
    <div class="auth-menu" id="auth-menu">
      <a class="auth-menu__item" href="#/perfil">${icon('user', { size: 16 })} Perfil</a>
      <a class="auth-menu__item" href="#/favoritos">${icon('heart', { size: 16 })} Favoritos</a>
      <a class="auth-menu__item" href="#/amigos">${icon('users', { size: 16 })} Amigos</a>
      <a class="auth-menu__item" href="#/afinador">${icon('audio-lines', { size: 16 })} Afinador <span class="badge--beta">BETA</span></a>
      <a class="auth-menu__item" href="#/recomendador">${icon('sparkles', { size: 16 })} Recomendador <span class="badge--beta">BETA</span></a>
      <a class="auth-menu__item" href="#/estudio">${icon('audio-lines', { size: 16 })} Estudio <span class="badge--beta">BETA</span></a>
      <button class="auth-menu__item auth-menu__item--danger" id="logout-btn">${icon('log-out', { size: 16 })} Cerrar sesión</button>
    </div>
  `;
}

/**
 * Render the auth button + dropdown into the given mount.
 * @param {HTMLElement} mount
 */
export function renderAuthButton(mount) {
  function update() {
    const profile = getProfile();
    if (!profile) {
      mount.innerHTML = '';
      return;
    }
    mount.innerHTML = buildButton(profile);

    const btn = mount.querySelector('#auth-button');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      let menu = document.querySelector('#auth-menu');
      if (menu) {
        menu.remove();
        return;
      }
      document.body.insertAdjacentHTML('beforeend', buildMenu());
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
}
