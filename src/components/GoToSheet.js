import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';

export const GO_TO_TILES = [
  {
    id: 'albumes',
    label: 'Álbumes',
    desc: 'Explora la discografía completa',
    route: '/albumes',
    iconKey: 'album',
    color: '--color-primary',
  },
  {
    id: 'listas',
    label: 'Listas',
    desc: 'Crea colecciones efímeras de letras',
    route: '/listas',
    iconKey: 'list',
    color: '--color-violet-500',
  },
  {
    id: 'oracion',
    label: 'Oración',
    desc: 'Un momento contemplativo con el artista',
    route: '/oracion',
    iconKey: 'flame',
    color: '--color-liturgy',
  },
  {
    id: 'favoritos',
    label: 'Favoritos',
    desc: 'Tus letras guardadas',
    route: '/favoritos',
    iconKey: 'heart',
    color: '--color-rose-300',
  },
  {
    id: 'voces',
    label: 'Voces',
    desc: 'Perfiles y voces del grupo',
    route: '/voces',
    iconKey: 'gospel',
    color: '--color-success',
  },
  {
    id: 'cache',
    label: 'Limpiar caché',
    desc: 'Libera espacio y datos offline',
    iconKey: 'rotate-ccw',
    action: 'clearCache',
    color: '--color-text-secondary',
  },
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

const CLOSE_FALLBACK_MS = 200;

/** @type {{ dim: HTMLElement, sheet: HTMLElement, close: Function } | null} */
let openEls = null;

/**
 * Abre la hoja "Ir a…" con la lista de tiles de navegación.
 * Idempotente: si ya hay una hoja abierta, devuelve el controlador vivo.
 * @param {string} [currentPath]
 * @param {{ onClose?: Function }} [opts]
 * @returns {{ close: Function }}
 */
export function openGoToSheet(currentPath = '', { onClose } = {}) {
  if (openEls) return { close: openEls.close };
  // Reapertura rápida: retira cualquier hoja anterior aún saliendo (animación).
  document.querySelectorAll('.gsheet--closing, .gsheet-dim--closing').forEach((el) => el.remove());
  const active = activeTile(currentPath);

  const dim = document.createElement('div');
  dim.className = 'gsheet-dim';

  const sheet = document.createElement('div');
  sheet.className = 'gsheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Ir a');
  sheet.innerHTML = `
    <div class="gsheet__list">
      ${GO_TO_TILES.map((t) => {
        const dataAttr = t.action ? `data-action="${t.action}"` : `data-route="${t.route}"`;
        return `<button class="gsheet__row${t.id === active ? ' is-active' : ''}" style="--tile-color: var(${t.color});" ${dataAttr}>
          <span class="gsheet__ic">${icon(t.iconKey, { size: 22 })}</span>
          <span class="gsheet__txt">
            <span class="gsheet__label">${t.label}</span>
            <span class="gsheet__desc">${t.desc}</span>
          </span>
        </button>`;
      }).join('')}
    </div>
  `;

  document.body.classList.add('menu-open');

  let closed = false;
  function unmount() {
    dim.remove();
    sheet.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  function close() {
    if (closed) return;
    closed = true;
    // Se libera de inmediato para permitir reapertura durante la animación de salida.
    openEls = null;
    document.body.classList.remove('menu-open');
    document.removeEventListener('keydown', onKeydown);
    onClose?.();

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      unmount();
      return;
    }

    dim.classList.add('gsheet-dim--closing');
    sheet.classList.add('gsheet--closing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unmount();
    };
    sheet.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, CLOSE_FALLBACK_MS);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeydown);

  dim.addEventListener('click', close);

  // Filas con ruta → navegar
  sheet.querySelectorAll('[data-route]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = b.dataset.route;
      close();
      navigate(r);
    }),
  );

  // Filas con acción → ejecutar
  sheet.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', async () => {
      close();
      const { clearAppCache } = await import('../lib/cacheClear.js');
      clearAppCache();
    }),
  );

  document.body.append(dim, sheet);
  openEls = { dim, sheet, close };
  return { close };
}

/**
 * Cierra la hoja "Ir a…" si está abierta (dispara la salida animada).
 * No-op si no hay hoja abierta.
 */
export function closeGoToSheet() {
  openEls?.close();
}

/**
 * @returns {boolean} true si la hoja "Ir a…" está abierta.
 */
export function isGoToSheetOpen() {
  return openEls !== null;
}
