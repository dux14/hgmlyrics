/**
 * BottomNav.js — Navegación principal para móvil (<768 px).
 *
 * 4 tabs: Inicio · Buscar · Herramientas · Perfil.
 * Visible solo en móvil (oculto en ≥768px vía CSS).
 * Iconos via helper icon() — sin emojis.
 */

import { icon } from '../lib/icons.js';
import { navigate } from '../router.js';

/** Tabs configurados: { id, label, path, iconKey, matchPaths } */
const TABS = [
  { id: 'inicio', label: 'Inicio', path: '/', iconKey: 'home', matchPaths: ['/', ''] },
  { id: 'buscar', label: 'Buscar', path: '/buscar', iconKey: 'search', matchPaths: ['/buscar'] },
  {
    id: 'herramientas',
    label: 'Herramientas',
    path: '/herramientas',
    iconKey: 'wrench',
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
    a.innerHTML = `${icon(tab.iconKey, { size: 22 })}<span>${tab.label}</span>`;

    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(tab.path);
    });

    nav.appendChild(a);
  }

  container.appendChild(nav);
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
