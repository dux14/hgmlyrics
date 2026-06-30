import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';

export const GO_TO_TILES = [
  { id: 'albumes', label: 'Álbumes', route: '/buscar', iconKey: 'album' },
  { id: 'listas', label: 'Listas', route: '/lista/nueva', iconKey: 'list' },
  { id: 'oracion', label: 'Oración', route: '/oracion', iconKey: 'flame' },
  { id: 'favoritos', label: 'Favoritos', route: '/favoritos', iconKey: 'heart' },
  { id: 'voces', label: 'Voces', route: '/voces', iconKey: 'gospel' },
  { id: 'mundo', label: 'Mundo', route: '/mundo', iconKey: 'globe' },
];

/**
 * Devuelve el id del tile activo para la ruta dada, o null si ninguno coincide.
 * Ignora querystring y acepta coincidencias por prefijo de subruta.
 * @param {string} path
 * @returns {string|null}
 */
export function activeTile(path) {
  const clean = (path || '/').split('?')[0];
  const t = GO_TO_TILES.find((x) => clean === x.route || clean.startsWith(`${x.route}/`));
  return t ? t.id : null;
}

/** @type {{ dim: HTMLElement, sheet: HTMLElement, close: Function } | null} */
let openEls = null;

/**
 * Abre la hoja "Ir a…" con 6 tiles de navegacion.
 * Si ya hay una hoja abierta, no hace nada.
 * @param {string} [currentPath]
 */
export function openGoToSheet(currentPath = '') {
  if (openEls) return;
  const active = activeTile(currentPath);

  const dim = document.createElement('div');
  dim.className = 'gsheet-dim';

  const sheet = document.createElement('div');
  sheet.className = 'gsheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Ir a');
  sheet.innerHTML = `
    <div class="gsheet__grab"></div>
    <div class="gsheet__h syn">Ir a</div>
    <div class="gsheet__grid">
      ${GO_TO_TILES.map(
        (t) => `<button class="gsheet__tile${t.id === active ? ' is-active' : ''}" data-route="${t.route}">
          <span class="gsheet__ic">${icon(t.iconKey, { size: 22 })}</span>
          <span class="gsheet__lb">${t.label}</span>
        </button>`,
      ).join('')}
    </div>
  `;

  function close() {
    dim.remove();
    sheet.remove();
    openEls = null;
  }

  dim.addEventListener('click', close);
  sheet.querySelectorAll('[data-route]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = b.dataset.route;
      close();
      navigate(r);
    }),
  );

  document.body.append(dim, sheet);
  openEls = { dim, sheet, close };
  return openEls;
}
