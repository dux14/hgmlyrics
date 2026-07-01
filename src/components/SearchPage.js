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
import { searchEverything } from '../lib/search.js';

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
/**
 * Baraja estable por sesión (semilla en sessionStorage). Si el almacenamiento
 * está bloqueado (Safari privado, WebViews, anti-tracking) usa una semilla
 * volátil para no romper el render — no persiste entre renders pero no lanza.
 */
function stableShuffle(arr) {
  let seed;
  try {
    seed = sessionStorage.getItem('hkn-search-shuffle-seed');
    if (!seed) { seed = String(Math.random()); sessionStorage.setItem('hkn-search-shuffle-seed', seed); }
  } catch (_e) {
    seed = seed || 'hkn-fallback-seed';
  }
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

/** Renderiza resultados seccionados (Canciones → Álbumes → Voz en off) en `box`. */
function renderInlineResults(box, query) {
  box.innerHTML = '';
  const { songs, albums, voces } = searchEverything(query);
  const section = (label, items, render) => {
    if (!items.length) return;
    const h = document.createElement('div');
    h.className = 'search-focus__group';
    h.textContent = `${label} · ${items.length}`;
    box.appendChild(h);
    items.forEach((it) => box.appendChild(render(it)));
  };
  section('Canciones', songs, (s) => {
    const a = document.createElement('a');
    a.className = 'voz-card';
    a.innerHTML = `<img class="voz-card__art" src="${resolveCoverUrl(s)}" alt="" width="40" height="40" onerror="this.src='${COVER_PLACEHOLDER}'"><div><div class="voz-card__title">${escapeHtml(s.title)}</div><div class="voz-card__ref">${escapeHtml(s.album || '')}</div></div>`;
    a.addEventListener('click', (e) => { e.preventDefault(); navigate(`/song/${s.id}`); });
    return a;
  });
  section('Álbumes', albums, (al) => {
    const a = document.createElement('a');
    a.className = 'voz-card';
    a.innerHTML = `<img class="voz-card__art" src="${resolveCoverUrl(al)}" alt="" width="40" height="40" onerror="this.src='${COVER_PLACEHOLDER}'"><div><div class="voz-card__title">${escapeHtml(al.name)}</div><div class="voz-card__ref">Álbum</div></div>`;
    a.addEventListener('click', (e) => { e.preventDefault(); navigate(`/buscar?album=${encodeURIComponent(al.slug)}`); });
    return a;
  });
  section('Voz en off', voces, (v) => {
    const a = document.createElement('a');
    a.className = 'voz-card';
    a.innerHTML = `<div class="voz-card__art">${icon('gospel', { size: 18 })}</div><div><div class="voz-card__title">${escapeHtml(v.title || v.liturgical_title || 'Voz en off')}</div><div class="voz-card__ref">${escapeHtml(v.gospel_ref || '')}</div></div>`;
    a.addEventListener('click', (e) => { e.preventDefault(); navigate(`/voz/${v.id}`); });
    return a;
  });
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

  // Barra sticky
  const bar = document.createElement('div');
  bar.className = 'search-bar';
  bar.innerHTML = `
    ${icon('search', { size: 18 })}
    <input type="search" placeholder="Buscar canciones, álbumes, voces…" aria-label="Buscar" />
    <button type="button" class="search-bar__clear" aria-label="Limpiar búsqueda" hidden>${icon('close', { size: 18 })}</button>
  `;
  page.appendChild(bar);

  // Contenedor del hub (secciones)
  const hub = document.createElement('div');
  hub.className = 'search-hub';

  // 1 · Álbumes
  const albums = [...getAlbums()].sort(
    (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name, 'es'),
  );
  const coverBySlug = {};
  albums.forEach((al) => {
    if (al.slug && al.coverImage) coverBySlug[al.slug] = al.coverImage.replace(/^.*\//, '');
  });
  if (albums.length) {
    hub.appendChild(sectionHead('Álbumes'));
    const rail = document.createElement('div');
    rail.className = 'search-rail';
    albums.forEach((al) => rail.appendChild(albumCard(al, container)));
    hub.appendChild(rail);
  }

  // 2 · Todas las canciones (catálogo completo)
  hub.appendChild(sectionHead('Todas las canciones'));
  const grid = document.createElement('div');
  grid.className = 'song-tile-grid';
  stableShuffle(songs).forEach((song) => grid.appendChild(songTile(song, colorMap, coverBySlug)));
  hub.appendChild(grid);

  // 3 · Voces en off
  if (weeklyWords.length) {
    hub.appendChild(sectionHead('Voces en off', () => navigate('/voces')));
    const rail = document.createElement('div');
    rail.className = 'search-rail';
    weeklyWords.forEach((ww) => rail.appendChild(vozCard(ww)));
    hub.appendChild(rail);
  }

  // 4 · Tus favoritos (solo autenticado + con favoritos)
  if (isAuthenticated()) {
    const favs = songs.filter((s) => isFavorite(s.id));
    if (favs.length) {
      hub.appendChild(sectionHead('Tus favoritos', () => navigate('/favoritos')));
      const fgrid = document.createElement('div');
      fgrid.className = 'song-tile-grid';
      favs.forEach((song) => fgrid.appendChild(songTile(song, colorMap, coverBySlug)));
      hub.appendChild(fgrid);
    }
  }

  page.appendChild(hub);

  // Focus inline: barra controla hub vs resultados
  const input = bar.querySelector('input');
  const clearBtn = bar.querySelector('.search-bar__clear');
  let results = null;

  function enterFocus() {
    if (!results) {
      results = document.createElement('div');
      results.className = 'search-inline-results';
      page.appendChild(results);
    }
    hub.hidden = true;
    clearBtn.hidden = false;
    renderInlineResults(results, input.value);
  }
  function exitFocus() {
    input.value = '';
    if (results) { results.remove(); results = null; }
    hub.hidden = false;
    clearBtn.hidden = true;
    // Restaurar cualquier filtro de álbum aplicado por albumCard antes del focus.
    hub.querySelectorAll('.song-tile').forEach((t) => { t.style.display = ''; });
  }
  input.addEventListener('input', () => {
    if (input.value.trim()) enterFocus();
    else exitFocus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { exitFocus(); input.blur(); }
  });
  clearBtn.addEventListener('click', () => { exitFocus(); input.focus(); });

  container.appendChild(page);
}
