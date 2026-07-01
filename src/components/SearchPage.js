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

/** PRNG determinista (mulberry32) — para barajar estable por sesión. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Fisher-Yates sembrado. Pura: mismo (arr, seedStr) → misma permutación. */
export function seededShuffle(arr, seedStr) {
  const rand = mulberry32(seedFromString(seedStr));
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** Baraja estable por sesión (semilla en sessionStorage). */
function stableShuffle(arr) {
  let seed = sessionStorage.getItem('hkn-search-shuffle-seed');
  if (!seed) { seed = String(Math.random()); sessionStorage.setItem('hkn-search-shuffle-seed', seed); }
  return seededShuffle(arr, seed);
}

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
    <div class="voz-card__art">${icon('gospel', { size: 18 })}</div>
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

  // 1 · Álbumes
  const albums = [...getAlbums()].sort(
    (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name, 'es'),
  );
  const coverBySlug = {};
  albums.forEach((al) => {
    if (al.slug && al.coverImage) coverBySlug[al.slug] = al.coverImage.replace(/^.*\//, '');
  });
  if (albums.length) {
    page.appendChild(sectionHead('Álbumes'));
    const rail = document.createElement('div');
    rail.className = 'search-rail';
    albums.forEach((al) => rail.appendChild(albumCard(al, container)));
    page.appendChild(rail);
  }

  // 2 · Todas las canciones (catálogo completo)
  page.appendChild(sectionHead('Todas las canciones'));
  const grid = document.createElement('div');
  grid.className = 'song-tile-grid';
  stableShuffle(songs).forEach((song) => grid.appendChild(songTile(song, colorMap, coverBySlug)));
  page.appendChild(grid);

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
      favs.forEach((song) => fgrid.appendChild(songTile(song, colorMap, coverBySlug)));
      page.appendChild(fgrid);
    }
  }

  container.appendChild(page);
}
