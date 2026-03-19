/**
 * ThemeToggle.js — Dark/Light mode toggle
 *
 * Persists preference in localStorage.
 * Respects prefers-color-scheme as default.
 */

const THEME_KEY = 'hkn-theme';

/**
 * Get the current theme
 * @returns {'light'|'dark'}
 */
export function getTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch (_e) {
    // localStorage unavailable
  }

  // System preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Apply theme to the document
 * @param {'light'|'dark'} theme
 */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#0F0F0F' : '#0097A7');
  }
}

/**
 * Initialize theme on page load
 */
export function initTheme() {
  const theme = getTheme();
  applyTheme(theme);
}

/**
 * Render the theme toggle button
 * @param {HTMLElement} container
 */
export function renderThemeToggle(container) {
  const btn = document.createElement('button');
  btn.className = 'theme-toggle header__btn';
  btn.id = 'theme-toggle';
  btn.setAttribute('aria-label', 'Cambiar tema');
  btn.title = 'Cambiar tema claro/oscuro';

  updateIcon(btn);

  btn.addEventListener('click', () => {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_e) {
      // Ignore
    }

    applyTheme(next);
    updateIcon(btn);
  });

  container.appendChild(btn);
}

/**
 * Update the toggle icon based on current theme
 * @param {HTMLElement} btn
 */
function updateIcon(btn) {
  const theme = getTheme();

  if (theme === 'dark') {
    // Show sun icon (click to switch to light)
    btn.innerHTML = `
      <svg class="theme-toggle__icon theme-toggle__icon--sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
    `;
  } else {
    // Show moon icon (click to switch to dark)
    btn.innerHTML = `
      <svg class="theme-toggle__icon theme-toggle__icon--moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    `;
  }
}
