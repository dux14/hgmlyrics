/**
 * BottomNav.js — Navegación principal para móvil (<768 px).
 *
 * 4 tabs: Inicio · Buscar · Herramientas · Perfil.
 * Visible solo en móvil (oculto en ≥768px vía CSS).
 * Iconos via helper icon() — sin emojis.
 * El tab Perfil muestra la foto del usuario si tiene avatar.
 */

import { icon } from '../lib/icons.js';
import { navigate } from '../router.js';
import { getProfile, subscribe } from '../lib/authStore.js';

/** Tabs configurados: { id, label, path, iconKey, matchPaths } */
const TABS = [
  { id: 'inicio', label: 'Inicio', path: '/', iconKey: 'home', matchPaths: ['/', ''] },
  { id: 'buscar', label: 'Buscar', path: '/buscar', iconKey: 'search', matchPaths: ['/buscar'] },
  {
    id: 'herramientas',
    label: 'Herramientas',
    path: '/herramientas',
    iconKey: 'sliders',
    matchPaths: ['/herramientas', '/afinador', '/recomendador', '/estudio'],
  },
  { id: 'perfil', label: 'Perfil', path: '/perfil', iconKey: 'user', matchPaths: ['/perfil'] },
];

/**
 * Devuelve el id del tab activo dado el path actual, o null si ningún tab coincide.
 * Normaliza: quita querystring antes de comparar.
 *
 * @param {string} path — p.ej. '/', '/buscar?q=x', '/song/123'
 * @returns {'inicio'|'buscar'|'herramientas'|'perfil'|null}
 */
export function activeTab(path) {
  // Quitar querystring
  const clean = (path || '').split('?')[0];

  for (const tab of TABS) {
    if (tab.matchPaths.includes(clean)) return tab.id;
  }
  return null;
}

/**
 * Devuelve el HTML del icono para el tab Perfil.
 * Si el usuario tiene avatarUrl, renderiza una <img>; en caso contrario el icono 'user'.
 */
function profileIconHtml() {
  const avatarUrl = getProfile()?.avatarUrl;
  if (avatarUrl) {
    return `<img class="bottom-nav__avatar" src="${avatarUrl}" alt="">`;
  }
  return icon('user', { size: 24 });
}

/**
 * Crea y monta el componente bottom-nav dentro de `container`.
 *
 * @param {HTMLElement} container — normalmente el elemento #app
 */
export function renderBottomNav(container) {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Navegación principal');

  for (const tab of TABS) {
    const a = document.createElement('a');
    a.className = 'bottom-nav__item';
    a.href = tab.path;
    a.dataset.tab = tab.id;

    const iconHtml = tab.id === 'perfil' ? profileIconHtml() : icon(tab.iconKey, { size: 24 });
    a.innerHTML = `${iconHtml}<span>${tab.label}</span>`;

    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(tab.path);
    });

    nav.appendChild(a);
  }

  container.appendChild(nav);

  // Re-renderizar solo el tab Perfil cuando cambie el avatar en authStore
  const unsub = subscribe(() => {
    const pfTab = nav.querySelector('[data-tab="perfil"]');
    if (!pfTab) return;
    const span = pfTab.querySelector('span');
    pfTab.innerHTML = `${profileIconHtml()}<span>${span.textContent}</span>`;
  });

  // Guardar referencia para limpiar si el nav fuera eliminado del DOM
  nav._unsubAuthStore = unsub;
}

/**
 * Actualiza el tab visualmente activo según el path dado.
 * Marca aria-current="page" y clase --active en el tab activo; limpia el resto.
 *
 * @param {string} path — ruta actual
 */
export function updateBottomNavActive(path) {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;

  const active = activeTab(path);

  nav.querySelectorAll('.bottom-nav__item').forEach((a) => {
    const isActive = a.dataset.tab === active;
    a.classList.toggle('bottom-nav__item--active', isActive);
    if (isActive) {
      a.setAttribute('aria-current', 'page');
    } else {
      a.removeAttribute('aria-current');
    }
  });
}
