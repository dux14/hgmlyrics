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
