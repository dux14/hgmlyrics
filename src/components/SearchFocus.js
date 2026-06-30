/**
 * SearchFocus.js — overlay de búsqueda en vivo: scrim + barra elevada + resultados
 * seccionados (Canciones → Álbumes → Voz en off). Reemplaza al CommandPalette.
 */
import { navigate } from '../router.js';
import { searchEverything } from '../lib/search.js';
import { resolveCoverUrl } from './songRow.js';
import { escapeHtml } from '../lib/escape.js';
import { icon, COVER_PLACEHOLDER } from '../lib/icons.js';

let root = null;

function close() {
  if (!root) return;
  root.remove();
  root = null;
  document.removeEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') close(); }

function renderResults(box, query) {
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
    a.addEventListener('click', () => { close(); navigate(`/song/${s.id}`); });
    return a;
  });
  section('Álbumes', albums, (al) => {
    const a = document.createElement('a');
    a.className = 'voz-card';
    a.innerHTML = `<img class="voz-card__art" src="${resolveCoverUrl(al)}" alt="" width="40" height="40" onerror="this.src='${COVER_PLACEHOLDER}'"><div><div class="voz-card__title">${escapeHtml(al.name)}</div><div class="voz-card__ref">Álbum</div></div>`;
    a.addEventListener('click', () => { close(); navigate(`/buscar?album=${encodeURIComponent(al.slug)}`); });
    return a;
  });
  section('Voz en off', voces, (v) => {
    const a = document.createElement('a');
    a.className = 'voz-card';
    a.innerHTML = `<div class="voz-card__art">${icon('music', { size: 18 })}</div><div><div class="voz-card__title">${escapeHtml(v.title || v.liturgical_title || 'Voz en off')}</div><div class="voz-card__ref">${escapeHtml(v.gospel_ref || '')}</div></div>`;
    a.addEventListener('click', () => { close(); navigate(`/voz/${v.id}`); });
    return a;
  });
}

/** Abre el overlay de focus. @param {string} [initial] query inicial */
export function openSearchFocus(initial = '') {
  // Si root fue eliminado del DOM externamente (p.ej. teardown de tests), resetear estado
  if (root && !document.body.contains(root)) {
    document.removeEventListener('keydown', onKey);
    root = null;
  }
  if (root) return;
  root = document.createElement('div');
  root.innerHTML = `
    <div class="search-focus__scrim"></div>
    <div class="search-focus__bar">
      ${icon('search', { size: 16 })}
      <input type="search" placeholder="Buscar canciones, álbumes, voces…" aria-label="Buscar" />
    </div>
    <div class="search-focus__results" role="listbox"></div>
  `;
  document.body.appendChild(root);

  const input = root.querySelector('input');
  const box = root.querySelector('.search-focus__results');
  input.value = initial;
  renderResults(box, initial);
  input.addEventListener('input', () => renderResults(box, input.value));
  root.querySelector('.search-focus__scrim').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  input.focus();
}
