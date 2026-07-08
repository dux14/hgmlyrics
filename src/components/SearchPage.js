/**
 * SearchPage.js — landing de /buscar (browse hub):
 * catálogo completo en tiles + rails de Álbumes, Voces en off y Favoritos.
 */
import { navigate, openBackable, closeBackable, clearBackable } from '../router.js';
import { getState, getAlbums } from '../lib/store.js';
import { resolveCoverUrl } from './songRow.js';
import { isAuthenticated } from '../lib/authStore.js';
import { isFavorite } from '../lib/favorites.js';
import { icon, COVER_PLACEHOLDER } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { songTile } from './songTile.js';
import { searchEverything } from '../lib/search.js';
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelRowList } from '../lib/skeleton.js';
import { getWeeklyWords } from '../lib/weeklyWords.js';

/** PRNG determinista (mulberry32) — para barajar estable por sesión. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
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
/** Baraja con semilla fresca en cada render — variedad en cada entrada a /buscar. */
function stableShuffle(arr) {
  return seededShuffle(arr, String(Math.random()));
}

let colorMap = {};
let colorsLoaded = false;

async function ensureColors() {
  if (colorsLoaded) return;
  try {
    const res = await fetch('/cover-colors.json');
    if (res.ok) colorMap = await res.json();
  } catch (_e) {
    /* fallback a colores neutros */
  }
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
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(`/voz/${ww.id}`);
  });
  return a;
}

/**
 * Trae las voces en off para el rail del hub. Fuente única SWR: `getWeeklyWords()`
 * (fetch autenticado + cache compartida con Home/otras vistas).
 */
async function fetchVocesEnOff() {
  return getWeeklyWords();
}

/**
 * Renderiza el browse hub dentro de `container`.
 * @param {HTMLElement} container
 * @param {Array|null} weeklyWords - semilla SWR opcional; si es null la seccion de voces hace su propio fetch con skeleton
 */
export async function renderSearchPage(container, weeklyWords = null) {
  container.innerHTML = '';
  await ensureColors();

  const { songs } = getState();
  const page = document.createElement('div');
  page.className = 'search-page';

  // Barra sticky
  const bar = document.createElement('div');
  bar.className = 'search-bar';
  bar.innerHTML = `
    <span class="search-bar__icon">${icon('search', { size: 18 })}</span>
    <input type="search" placeholder="Buscar canciones, álbumes, voces…" aria-label="Buscar" />
    <button type="button" class="search-bar__clear" aria-label="Limpiar búsqueda" hidden>${icon('close', { size: 18 })}</button>
  `;
  // Cancelar queda FUERA del pill (.search-bar) — a la derecha del wrap (Spotify-style).
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'search-bar__cancel';
  cancelBtn.hidden = true;
  cancelBtn.textContent = 'Cancelar';
  // Wrapper sticky: banda negra sólida que cubre el header al scrollear (Feature 2).
  // La banda sticks en top:0 con z-index > --z-header, tapando el header fijo.
  const barWrap = document.createElement('div');
  barWrap.className = 'search-bar-wrap';
  barWrap.appendChild(bar);
  barWrap.appendChild(cancelBtn);
  page.appendChild(barWrap);

  // Contenedor del hub (secciones)
  const hub = document.createElement('div');
  hub.className = 'search-hub';

  // 1 · Álbumes
  const albums = [...getAlbums()].sort(
    (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name, 'es'),
  );
  const coverBySlug = {};
  albums.forEach((al) => {
    if (!al.slug || !al.coverImage) return;
    const c = al.coverImage;
    // Portada remota (Storage) o ruta absoluta → preservar tal cual.
    // Portada local → quedarnos con el nombre de archivo (clave de cover-colors.json).
    coverBySlug[al.slug] = /^(https?:|\/)/.test(c) ? c : c.replace(/^.*\//, '');
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

  // 3 · Voces en off — region async: el shell del hub pinta al instante y esta
  // seccion carga aparte (skeleton + SWR). Evita que /api/weekly-words bloquee /buscar.
  const vocesRegion = document.createElement('div');
  vocesRegion.className = 'search-voces-region';
  hub.appendChild(vocesRegion);

  renderAsyncRegion(vocesRegion, {
    cached: weeklyWords,
    skeleton: () =>
      `<div class="search-section__head"><h2>Voces en off</h2></div>${skelRowList({ rows: 3 })}`,
    fetcher: fetchVocesEnOff,
    render: (words) => {
      vocesRegion.innerHTML = '';
      vocesRegion.appendChild(sectionHead('Voces en off', () => navigate('/voces')));
      const rail = document.createElement('div');
      rail.className = 'search-rail';
      words.forEach((ww) => rail.appendChild(vozCard(ww)));
      vocesRegion.appendChild(rail);
    },
    empty: () => '',
    onError: () =>
      `<div class="search-section__head"><h2>Voces en off</h2></div>` +
      `<p class="search-voces-error">No se pudieron cargar las voces. <button type="button" data-retry>Reintentar</button></p>`,
  });

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

  // Modo focus estilo Spotify: la barra se ancla arriba (via CSS body.search-focus),
  // el header global desaparece y se muestra el botón Cancelar.
  // Es una capa "backable": el atrás nativo cierra el focus en vez de abandonar /buscar.
  // Al (re)montar la página se descarta cualquier capa huérfana de una instancia anterior.
  clearBackable();
  const input = bar.querySelector('input');
  const clearBtn = bar.querySelector('.search-bar__clear');
  let overlayOpen = false;

  const resultsBox = document.createElement('div');
  resultsBox.className = 'search-inline-results';
  page.appendChild(resultsBox);

  /** Renderiza filas .search-row seccionadas. Muestra empty state si 0 resultados. */
  function showResults(query) {
    hub.hidden = true;
    clearBtn.hidden = false;
    resultsBox.innerHTML = '';
    const { songs: foundSongs, albums: foundAlbums, voces: foundVoces } = searchEverything(query);
    const total = foundSongs.length + foundAlbums.length + foundVoces.length;
    if (!total) {
      const p = document.createElement('p');
      p.className = 'search-empty';
      p.textContent = `Sin resultados para «${query}»`;
      resultsBox.appendChild(p);
      return;
    }
    const section = (label, items, render) => {
      if (!items.length) return;
      const h = document.createElement('div');
      h.className = 'search-focus__group';
      h.textContent = label;
      resultsBox.appendChild(h);
      items.forEach((it) => resultsBox.appendChild(render(it)));
    };
    section('Canciones', foundSongs, (s) => {
      const a = document.createElement('a');
      a.className = 'search-row';
      a.href = `/song/${s.id}`;
      a.innerHTML = `<img class="search-row__cover" src="${resolveCoverUrl(s)}" alt="" width="56" height="56" loading="lazy" decoding="async" onerror="this.src='${COVER_PLACEHOLDER}'"><div class="search-row__info"><div class="search-row__title">${escapeHtml(s.title)}</div><div class="search-row__sub">Canción · ${escapeHtml(s.album || '')}</div></div>`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigateFromFocus(`/song/${s.id}`);
      });
      return a;
    });
    section('Álbumes', foundAlbums, (al) => {
      const a = document.createElement('a');
      a.className = 'search-row';
      a.href = `/buscar?album=${encodeURIComponent(al.slug)}`;
      a.innerHTML = `<img class="search-row__cover" src="${resolveCoverUrl(al)}" alt="" width="56" height="56" loading="lazy" decoding="async" onerror="this.src='${COVER_PLACEHOLDER}'"><div class="search-row__info"><div class="search-row__title">${escapeHtml(al.name)}</div><div class="search-row__sub">Álbum · ${escapeHtml(al.artist || 'Hakuna Group Music')}</div></div>`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigateFromFocus(`/buscar?album=${encodeURIComponent(al.slug)}`);
      });
      return a;
    });
    section('Voz en off', foundVoces, (v) => {
      const a = document.createElement('a');
      a.className = 'search-row';
      a.href = `/voz/${v.id}`;
      a.innerHTML = `<div class="search-row__cover search-row__cover--gospel">${icon('gospel', { size: 18 })}</div><div class="search-row__info"><div class="search-row__title">${escapeHtml(v.title || v.liturgical_title || 'Voz en off')}</div><div class="search-row__sub">Voz en off · ${escapeHtml(v.gospel_ref || '')}</div></div>`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigateFromFocus(`/voz/${v.id}`);
      });
      return a;
    });
  }

  /**
   * Navega a un destino desde el modo focus. NO usa closeBackable(): su
   * history.back() asíncrono compite con el push de navigate() y el navegador
   * termina aplicando el back DESPUÉS del push, devolviendo a /buscar (bug: los
   * resultados no navegaban). En su lugar la entrada backable se descarta y se
   * REEMPLAZA por el destino: sin carrera, y el atrás desde el destino vuelve
   * a /buscar como se espera.
   */
  function navigateFromFocus(path) {
    exitFocusVisual();
    if (overlayOpen) {
      overlayOpen = false;
      clearBackable();
      navigate(path, { replace: true });
    } else {
      navigate(path);
    }
  }

  /** Restaura el estado visual fuera del focus. No toca el history (uso interno). */
  function exitFocusVisual() {
    document.body.classList.remove('search-focus');
    input.value = '';
    input.blur();
    hub.hidden = false;
    clearBtn.hidden = true;
    cancelBtn.hidden = true;
    resultsBox.innerHTML = '';
    // Restaurar cualquier filtro de álbum aplicado por albumCard antes del focus.
    hub.querySelectorAll('.song-tile').forEach((t) => {
      t.style.display = '';
    });
  }

  /** Cierre disparado por el atrás nativo (vía la capa backable del router). */
  function exitFocusFromBack() {
    overlayOpen = false;
    exitFocusVisual();
  }

  /** Cierre iniciado por el usuario (Escape, Cancelar). */
  function requestExitFocus() {
    exitFocusVisual();
    if (overlayOpen) {
      overlayOpen = false;
      closeBackable(); // consume la entrada de history sin re-disparar el cierre
    }
  }

  // Entrar en focus al enfocar el input (tap o click)
  input.addEventListener('focus', () => {
    if (!overlayOpen) {
      document.body.classList.add('search-focus');
      cancelBtn.hidden = false;
      openBackable(exitFocusFromBack);
      overlayOpen = true;
    }
    if (input.value.trim()) showResults(input.value);
  });

  // Actualizar resultados al escribir
  input.addEventListener('input', () => {
    if (input.value.trim()) {
      showResults(input.value);
    } else {
      hub.hidden = false;
      clearBtn.hidden = true;
      resultsBox.innerHTML = '';
    }
  });

  // Escape sale del focus
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') requestExitFocus();
  });

  // ✕ borra el texto pero mantiene el focus activo (hub vuelve a ser visible)
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    hub.hidden = false;
    resultsBox.innerHTML = '';
    input.focus();
  });

  // Cancelar sale del focus
  cancelBtn.addEventListener('click', () => requestExitFocus());

  container.appendChild(page);
}
