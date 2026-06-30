/**
 * CommandPalette.js — Motor de resultados del command palette
 *
 * Exporta buildResults(query) y ACTIONS.
 * La capa DOM (controlador, teclado, CSS) se implementa aparte.
 */

import { searchSongs, normalize } from '../lib/search.js';
import { getAlbums, getState } from '../lib/store.js';
import { resolveCoverUrl } from './songRow.js';
import { applyTheme, getTheme } from './ThemeToggle.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';

/**
 * Lista estatica de acciones del launcher.
 * Los ids y rutas coinciden con los registrados en main.js.
 * @type {Array<{ id: string, title: string, iconKey: string, run: Function }>}
 */
export const ACTIONS = [
  { id: 'afinador', title: 'Abrir Afinador vocal', iconKey: 'mic', run: () => navigate('/afinador') },
  { id: 'recomendador', title: 'Abrir Recomendador', iconKey: 'sparkles', run: () => navigate('/recomendador') },
  { id: 'estudio', title: 'Abrir Estudio de pistas', iconKey: 'sliders', run: () => navigate('/estudio') },
  { id: 'inicio', title: 'Ir a Inicio', iconKey: 'home', run: () => navigate('/') },
  { id: 'buscar', title: 'Ir a Buscar', iconKey: 'search', run: () => navigate('/buscar') },
  { id: 'favoritos', title: 'Ir a Favoritos', iconKey: 'heart', run: () => navigate('/favoritos') },
  { id: 'oracion', title: 'Ir a Oracion', iconKey: 'book-open', run: () => navigate('/oracion') },
  { id: 'voces', title: 'Ir a Voces', iconKey: 'users', run: () => navigate('/voces') },
  { id: 'mundo', title: 'Ir a Mundo', iconKey: 'globe', run: () => navigate('/mundo') },
  { id: 'perfil', title: 'Ir a Perfil', iconKey: 'user', run: () => navigate('/perfil') },
  {
    id: 'tema',
    title: 'Cambiar tema',
    iconKey: 'sun-moon',
    run: () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark'),
  },
];

/**
 * Aplana todos los items de los grupos en un array plano navegable.
 * @param {Array<{ label: string, items: Array }>} groups
 * @returns {Array}
 */
export function getFlatItems(groups) {
  return groups.flatMap((g) => g.items);
}

/**
 * Nuevo indice activo con wrap circular.
 * @param {number} current  Indice actual
 * @param {number} delta    +1 (abajo) o -1 (arriba)
 * @param {number} length   Longitud total de la lista plana
 * @returns {number}
 */
export function moveActiveIndex(current, delta, length) {
  if (!length) return 0;
  return ((current + delta) % length + length) % length;
}

/**
 * Construye los grupos de resultados para el query dado.
 *
 * @param {string} query
 * @returns {Array<{ label: string, items: Array }>}
 *   Hasta 3 grupos en orden: Canciones -> Albumes -> Acciones.
 *   Los grupos vacios se omiten.
 */
export function buildResults(query) {
  const q = (query || '').trim();

  // Query vacio: mostrar todas las acciones como launcher
  if (q === '') {
    return [
      {
        label: 'Acciones',
        items: ACTIONS.map((a) => ({ ...a, kind: 'action' })),
      },
    ];
  }

  const nq = normalize(q);
  const groups = [];

  // Grupo Canciones
  const songItems = searchSongs(q, 5).map((song) => ({
    kind: 'song',
    id: song.id,
    title: song.title,
    subtitle: `${song.artist} · ${song.album}`,
    cover: resolveCoverUrl(song),
    run: () => navigate(`/song/${song.id}`),
  }));
  if (songItems.length > 0) {
    groups.push({ label: 'Canciones', items: songItems });
  }

  // Grupo Albumes
  const allSongs = getState().songs;
  const albumItems = getAlbums()
    .filter((a) => normalize(a.name).includes(nq))
    .slice(0, 3)
    .map((a) => {
      const count = allSongs.filter((s) => s.albumSlug === a.slug).length;
      return {
        kind: 'album',
        id: a.slug,
        title: a.name,
        subtitle: `${count} canciones`,
        cover: a.coverImage,
        run: () => navigate('/buscar'),
      };
    });
  if (albumItems.length > 0) {
    groups.push({ label: 'Albumes', items: albumItems });
  }

  // Grupo Acciones
  const actionItems = ACTIONS.filter((a) => normalize(a.title).includes(nq)).map((a) => ({
    ...a,
    kind: 'action',
  }));
  if (actionItems.length > 0) {
    groups.push({ label: 'Acciones', items: actionItems });
  }

  return groups;
}

// ─── Controlador DOM (singleton lazy) ────────────────────────────────────────

/** Estado de modulo del palette */
let _isOpen = false;
let _overlayEl = null;
let _listEl = null;
let _query = '';
let _groups = [];
let _activeIndex = 0;
let _initDone = false;
let _overlayKeydown = null;

/**
 * Abre el command palette por trigger (header pill). Funciona en cualquier
 * ancho. Idempotente: no hace nada si ya está abierto.
 */
export function openCommandPalette() {
  _open();
}

/**
 * Registra el shortcut global Cmd/Ctrl+K (solo desktop >=768px).
 * Llamar una vez despues de montar el shell.
 */
export function initCommandPalette() {
  if (_initDone) return;
  _initDone = true;
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      if (window.innerWidth < 768) return;
      e.preventDefault();
      _toggle();
    }
  });
}

function _toggle() {
  if (_isOpen) _close();
  else _open();
}

function _open() {
  // Si el overlay fue removido del DOM externamente, resetear el estado interno
  if (_isOpen && (!_overlayEl || !document.body.contains(_overlayEl))) {
    _isOpen = false;
    _overlayEl = null;
    _listEl = null;
  }
  if (_isOpen) return;
  _isOpen = true;
  _query = '';
  _activeIndex = 0;
  _groups = buildResults('');

  // Overlay (backdrop)
  _overlayEl = document.createElement('div');
  _overlayEl.className = 'cmdk-overlay';

  // Panel
  const panel = document.createElement('div');
  panel.className = 'cmdk';
  _overlayEl.appendChild(panel);

  // Fila del input
  const inputRow = document.createElement('div');
  inputRow.className = 'cmdk__input-row';

  const searchIconEl = document.createElement('span');
  searchIconEl.className = 'cmdk__search-icon';
  searchIconEl.innerHTML = icon('search', { size: 18 });

  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.className = 'cmdk__input';
  inputEl.placeholder = 'Buscar canciones, acciones...';
  inputEl.setAttribute('aria-label', 'Buscar en el palette');
  inputEl.setAttribute('autocomplete', 'off');
  inputEl.setAttribute('spellcheck', 'false');

  const escChip = document.createElement('span');
  escChip.className = 'cmdk__esc';
  escChip.textContent = 'ESC';

  inputRow.appendChild(searchIconEl);
  inputRow.appendChild(inputEl);
  inputRow.appendChild(escChip);
  panel.appendChild(inputRow);

  // Lista de resultados
  _listEl = document.createElement('div');
  _listEl.className = 'cmdk__list';
  panel.appendChild(_listEl);

  // Footer de atajos (HTML estatico, sin datos de usuario)
  const footer = document.createElement('div');
  footer.className = 'cmdk__footer';
  footer.innerHTML =
    '<kbd>↑</kbd><kbd>↓</kbd> navegar &nbsp;·&nbsp; <kbd>↵</kbd> abrir &nbsp;·&nbsp; <kbd>ESC</kbd> cerrar';
  panel.appendChild(footer);

  // Montar en el body
  document.body.appendChild(_overlayEl);
  document.documentElement.style.overflow = 'hidden';

  // Primer render
  _render();

  // Foco al input
  inputEl.focus();

  // Cambios en el input → recomputa grupos + re-render
  inputEl.addEventListener('input', () => {
    _query = inputEl.value;
    _activeIndex = 0;
    _groups = buildResults(_query);
    _render();
  });

  // Teclado sobre el overlay
  _overlayKeydown = (e) => {
    const flat = getFlatItems(_groups);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _activeIndex = moveActiveIndex(_activeIndex, 1, flat.length);
      _render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _activeIndex = moveActiveIndex(_activeIndex, -1, flat.length);
      _render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[_activeIndex];
      if (item) {
        item.run();
        _close();
      }
    } else if (e.key === 'Escape') {
      _close();
    }
  };
  document.addEventListener('keydown', _overlayKeydown);

  // Click en el backdrop (target directo = overlay) → cierra
  _overlayEl.addEventListener('click', (e) => {
    if (e.target === _overlayEl) _close();
  });
}

function _close() {
  if (!_isOpen) return;
  if (_overlayKeydown) {
    document.removeEventListener('keydown', _overlayKeydown);
    _overlayKeydown = null;
  }
  _overlayEl?.remove();
  _overlayEl = null;
  _listEl = null;
  document.documentElement.style.overflow = '';
  _isOpen = false;
}

/**
 * Re-pinta la lista de grupos/items en _listEl.
 * Marca con --active el item en _activeIndex (indice sobre lista plana).
 */
function _render() {
  if (!_listEl) return;
  _listEl.innerHTML = '';
  let flatIdx = 0;

  _groups.forEach((group) => {
    // Cabecera del grupo (Syncopate via CSS)
    const header = document.createElement('div');
    header.className = 'cmdk__group';
    header.textContent = group.label;
    _listEl.appendChild(header);

    group.items.forEach((item) => {
      const idx = flatIdx++;
      const isActive = idx === _activeIndex;

      const el = document.createElement('div');
      el.className = 'cmdk__item' + (isActive ? ' cmdk__item--active' : '');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(isActive));

      // Izquierda: portada o icono
      if (item.cover) {
        const img = document.createElement('img');
        img.className = 'cmdk__cover';
        img.src = item.cover;
        img.alt = '';
        img.width = 34;
        img.height = 34;
        el.appendChild(img);
      } else {
        const iconEl = document.createElement('span');
        iconEl.className = 'cmdk__icon';
        const iconKey = item.iconKey || (item.kind === 'album' ? 'disc-3' : 'zap');
        iconEl.innerHTML = icon(iconKey, { size: 16 });
        el.appendChild(iconEl);
      }

      // Texto: titulo + subtitulo
      const textEl = document.createElement('span');
      textEl.className = 'cmdk__text';

      const titleEl = document.createElement('span');
      titleEl.className = 'cmdk__title';
      titleEl.textContent = item.title;
      textEl.appendChild(titleEl);

      if (item.subtitle) {
        const subtitleEl = document.createElement('span');
        subtitleEl.className = 'cmdk__subtitle';
        subtitleEl.textContent = item.subtitle;
        textEl.appendChild(subtitleEl);
      }

      el.appendChild(textEl);

      // Glifico Enter (visible solo en item activo via CSS)
      const enterEl = document.createElement('span');
      enterEl.className = 'cmdk__enter';
      enterEl.textContent = '↵'; // ↵
      el.appendChild(enterEl);

      // mouseenter → activa sin keyboard
      el.addEventListener('mouseenter', () => {
        _activeIndex = idx;
        _render();
      });

      // click → ejecuta y cierra
      el.addEventListener('click', () => {
        item.run();
        _close();
      });

      _listEl.appendChild(el);
    });
  });
}
