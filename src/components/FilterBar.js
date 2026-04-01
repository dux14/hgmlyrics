/**
 * FilterBar.js — Horizontal filter chips bar
 *
 * Renders sort and voice filter chips below the header.
 * Scrollable horizontally on mobile.
 */

import { getState, setSortMode, filterByVoice } from '../lib/store.js';

const SORT_OPTIONS = [
  { value: 'a-z', label: 'A → Z' },
  { value: 'z-a', label: 'Z → A' },
  { value: 'recent', label: 'Recientes' },
  { value: 'album', label: 'Por álbum' },
];

const VOICE_OPTIONS = [
  { value: '', label: 'Todas las voces' },
  { value: 'male', label: 'Masculina' },
  { value: 'female', label: 'Femenina' },
  { value: 'mixed', label: 'Mixta' },
];

let filterBarEl = null;

/**
 * Render the filter bar into the app
 * @param {HTMLElement} container - The #app element
 */
export function renderFilterBar(container) {
  filterBarEl = document.createElement('div');
  filterBarEl.className = 'filter-bar';
  filterBarEl.id = 'filter-bar';

  updateFilterBar();

  // Insert after the header
  const header = container.querySelector('.header');
  if (header && header.nextSibling) {
    container.insertBefore(filterBarEl, header.nextSibling);
  } else {
    container.appendChild(filterBarEl);
  }
}

/**
 * Update filter bar content (called on state changes)
 */
export function updateFilterBar() {
  if (!filterBarEl) return;

  const { sortMode, voiceFilter } = getState();

  const hasNonDefaultFilters = sortMode !== 'a-z' || voiceFilter;

  filterBarEl.innerHTML = `
    ${SORT_OPTIONS.map(opt => `
      <button class="filter-chip ${sortMode === opt.value ? 'filter-chip--active' : ''}"
              data-sort="${opt.value}">${opt.label}</button>
    `).join('')}
    <span class="filter-separator"></span>
    ${VOICE_OPTIONS.map(opt => `
      <button class="filter-chip ${(voiceFilter || '') === opt.value ? 'filter-chip--active' : ''}"
              data-voice="${opt.value}">${opt.label}</button>
    `).join('')}
    ${hasNonDefaultFilters ? `
      <span class="filter-separator"></span>
      <button class="filter-chip filter-chip--clear" id="filter-clear">✕ Limpiar</button>
    ` : ''}
  `;

  bindFilterBarEvents();
}

/**
 * Bind click events for filter chips
 */
function bindFilterBarEvents() {
  if (!filterBarEl) return;

  // Sort chips
  filterBarEl.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      setSortMode(btn.dataset.sort);
    });
  });

  // Voice chips
  filterBarEl.querySelectorAll('[data-voice]').forEach(btn => {
    btn.addEventListener('click', () => {
      filterByVoice(btn.dataset.voice || null);
    });
  });

  // Clear button
  const clearBtn = filterBarEl.querySelector('#filter-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      setSortMode('a-z');
      filterByVoice(null);
    });
  }
}

/**
 * Show filter bar (for list views)
 */
export function showFilterBar() {
  if (filterBarEl) filterBarEl.style.display = '';
}

/**
 * Hide filter bar (for song detail, admin, etc.)
 */
export function hideFilterBar() {
  if (filterBarEl) filterBarEl.style.display = 'none';
}
