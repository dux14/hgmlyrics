/**
 * SearchPage.js — landing de /buscar (browse hub):
 * catálogo completo en tiles + rails de Álbumes, Voces en off y Favoritos.
 */
import { navigate } from '../router.js';
import { getState, getAlbums } from '../lib/store.js';
import { resolveCoverUrl } from './songRow.js';
import { isAuthenticated } from '../lib/authStore.js';
import { isFavorite } from '../lib/favorites.js';
import { icon, COVER_PLACEHOLDER } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { songTile } from './songTile.js';

let colorMap = {};
let colorsLoaded = false;

async function ensureColors() {
  if (colorsLoaded) return;
  try {
    const res = await fetch('/cover-colors.json');
    if (res.ok) colorMap = await res.json();
  } catch (_e) { /* fallback a colores neutros */ }
  colorsLoaded = true;
}

function sectionHead(title, onMore) {
  const head = document.createElement('div');
  head.className = 'search-section__head';
  head.innerHTML = `<h2>${escapeHtml(title)}</h2>`;
  if (onMore) {
    const btn = document.createElement('button');
    btn.className = 'search-section__more';
    btn.type = 'button';
    btn.textContent = 'Ver todo';
    btn.addEventListener('click', onMore);
    head.appendChild(btn);
  }
  return head;
}

/**
 * Card de álbum en el rail. Al hacer click filtra los song-tiles del catálogo
 * en el contenedor padre mostrando solo los del álbum elegido.
 * Usa la clase .search-rail__album (no .album-card que pertenece a albums.css).
 */
function albumCard(album, container) {
  const a = document.createElement('a');
  a.className = 'search-rail__album';
  a.href = `/buscar?album=${encodeURIComponent(album.slug)}`;
  const cover = resolveCoverUrl(album);
  a.innerHTML = `<img src="${cover}" alt="" width="98" height="98" loading="lazy" decoding="async" onerror="this.src='${COVER_PLACEHOLDER}'"><span>${escapeHtml(album.name)}</span>`;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    container.querySelectorAll('.song-tile').forEach((t) => {
      t.style.display = t.getAttribute('aria-label')?.includes(`— ${album.name}`) ? '' : 'none';
    });
    container.scrollIntoView({ behavior: 'smooth' });
  });
  return a;
}

function vozCard(ww) {
  const a = document.createElement('a');
  a.className = 'voz-card';
  a.href = `/voz/${ww.id}`;
  a.innerHTML = `
    <div class="voz-card__art">${icon('mic', { size: 18 })}</div>
    <div>
      <div class="voz-card__title">${escapeHtml(ww.title || ww.liturgical_title || 'Voz en off')}</div>
      <div class="voz-card__ref">${escapeHtml(ww.gospel_ref || '')}</div>
    </div>`;
  a.addEventListener('click', (e) => { e.preventDefault(); navigate(`/voz/${ww.id}`); });
  return a;
}

/**
 * Renderiza el browse hub dentro de `container`.
 * @param {HTMLElement} container
 * @param {Array} weeklyWords - voces en off (puede ser vacío)
 */
export async function renderSearchPage(container, weeklyWords = []) {
  container.innerHTML = '';
  await ensureColors();

  const { songs } = getState();
  const page = document.createElement('div');
  page.className = 'search-page';

  // 1 · Todas las canciones (catálogo completo)
  page.appendChild(sectionHead('Todas las canciones'));
  const grid = document.createElement('div');
  grid.className = 'song-tile-grid';
  songs.forEach((song) => grid.appendChild(songTile(song, colorMap)));
  page.appendChild(grid);

  // 2 · Álbumes
  const albums = getAlbums();
  if (albums.length) {
    page.appendChild(sectionHead('Álbumes'));
    const rail = document.createElement('div');
    rail.className = 'search-rail';
    albums.forEach((al) => rail.appendChild(albumCard(al, container)));
    page.appendChild(rail);
  }

  // 3 · Voces en off
  if (weeklyWords.length) {
    page.appendChild(sectionHead('Voces en off', () => navigate('/voces')));
    const rail = document.createElement('div');
    rail.className = 'search-rail';
    weeklyWords.forEach((ww) => rail.appendChild(vozCard(ww)));
    page.appendChild(rail);
  }

  // 4 · Tus favoritos (solo autenticado + con favoritos)
  if (isAuthenticated()) {
    const favs = songs.filter((s) => isFavorite(s.id));
    if (favs.length) {
      page.appendChild(sectionHead('Tus favoritos', () => navigate('/favoritos')));
      const fgrid = document.createElement('div');
      fgrid.className = 'song-tile-grid';
      favs.forEach((song) => fgrid.appendChild(songTile(song, colorMap)));
      page.appendChild(fgrid);
    }
  }

  container.appendChild(page);
}
