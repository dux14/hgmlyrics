import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';

export const GO_TO_TILES = [
  { id: 'albumes', label: 'Álbumes', route: '/albumes', iconKey: 'album', color: '--color-primary' },
  { id: 'listas', label: 'Listas', route: '/listas', iconKey: 'list', color: '--color-violet-500' },
  { id: 'oracion', label: 'Oración', route: '/oracion', iconKey: 'flame', color: '--color-liturgy' },
  { id: 'favoritos', label: 'Favoritos', route: '/favoritos', iconKey: 'heart', color: '--color-rose-300' },
  { id: 'voces', label: 'Voces', route: '/voces', iconKey: 'gospel', color: '--color-success' },
  { id: 'cache', label: 'Limpiar caché', iconKey: 'rotate-ccw', action: 'clearCache', color: '--color-text-secondary' },
];

/**
 * Devuelve el id del tile activo para la ruta dada, o null si ninguno coincide.
 * Ignora querystring y acepta coincidencias por prefijo de subruta.
 * @param {string} path
 * @returns {string|null}
 */
export function activeTile(path) {
  const clean = (path || '/').split('?')[0];
  const t = GO_TO_TILES.find(
    (x) => x.route && (clean === x.route || clean.startsWith(`${x.route}/`)),
  );
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
      ${GO_TO_TILES.map((t) => {
        const dataAttr = t.action ? `data-action="${t.action}"` : `data-route="${t.route}"`;
        return `<button class="gsheet__tile${t.id === active ? ' is-active' : ''}" style="--tile-color: var(${t.color});" ${dataAttr}>
          <span class="gsheet__ic">${icon(t.iconKey, { size: 22 })}</span>
          <span class="gsheet__lb">${t.label}</span>
        </button>`;
      }).join('')}
    </div>
  `;

  function close() {
    dim.remove();
    sheet.remove();
    openEls = null;
  }

  dim.addEventListener('click', close);

  // Tiles con ruta → navegar
  sheet.querySelectorAll('[data-route]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = b.dataset.route;
      close();
      navigate(r);
    }),
  );

  // Tiles con acción → ejecutar
  sheet.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', async () => {
      close();
      const { clearAppCache } = await import('../lib/cacheClear.js');
      clearAppCache();
    }),
  );

  document.body.append(dim, sheet);
  openEls = { dim, sheet, close };
  return openEls;
}
