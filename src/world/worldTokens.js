/**
 * worldTokens.js — Resuelve CSS custom properties a valores que Phaser entiende.
 *
 * El canvas WebGL de Phaser no accede a CSS custom properties directamente.
 * Este modulo lee los tokens del DOM una sola vez al crear el juego y los
 * convierte a enteros 0xRRGGBB (sprites) o strings hex (texto/fondo).
 *
 * Limitacion conocida: si el usuario cambia el tema mientras el mundo esta
 * activo, los colores del canvas NO se actualizan — son constantes JS por
 * sesion de juego. Aceptable: los usuarios raramente cambian tema con el
 * mundo abierto.
 */

/**
 * Convierte un string hex CSS ('#rrggbb') a entero Phaser (0xRRGGBB).
 * @param {string} hex  String con o sin '#', p. ej. '#fca5a5' o 'fca5a5'.
 * @returns {number}
 */
export function cssToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Resuelve una CSS custom property a su valor hexadecimal en formato '#rrggbb'.
 *
 * Estrategia: crea un elemento temporal, le asigna `color: var(--token)`, lee
 * `getComputedStyle().color` — el navegador resuelve OKLCH/oklch al color final
 * como `rgb(r, g, b)` — y parsea los canales a hex.
 *
 * Debe llamarse despues de que el CSS este cargado en el DOM (dentro de
 * createGame() que se invoca desde WorldPage, siempre post-primer-render).
 *
 * @param {string} name      Nombre del token, p. ej. '--color-bg'.
 * @param {string} [fallback]  Hex de respaldo si el token no resuelve o el
 *                             entorno no tiene DOM (tests SSR, Node).
 * @returns {string}  Hex '#rrggbb'.
 */
export function resolveToken(name, fallback = '#000000') {
  if (typeof document === 'undefined') return fallback;

  const el = document.createElement('div');
  el.style.cssText = `display:none;color:var(${name})`;
  document.body.appendChild(el);
  const raw = window.getComputedStyle(el).color; // 'rgb(r, g, b)' o 'rgba(r, g, b, a)'
  document.body.removeChild(el);

  const match = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return fallback;

  const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Lee todos los tokens de color del mundo virtual una sola vez.
 * Llamar dentro de createGame() tras montar el DOM.
 *
 * Mapeo de tokens:
 *   --color-bg      → fondo del canvas Phaser
 *   --color-brand   → sprite del jugador local + label teal
 *   --color-danger  → sprite de peers (distingue del jugador)
 *   --color-text    → label de nombre de peers
 *
 * @returns {{
 *   bg: string,
 *   brand: string,
 *   brandInt: number,
 *   dangerInt: number,
 *   text: string,
 * }}
 */
export function readWorldColors() {
  // Fallbacks alineados con los valores dark del sistema de tokens.
  const bg     = resolveToken('--color-bg',     '#0a0a14');
  const brand  = resolveToken('--color-brand',  '#2dd4bf');
  const danger = resolveToken('--color-danger', '#fca5a5');
  const text   = resolveToken('--color-text',   '#f5f5f5');

  return {
    /** Fondo del canvas (hex string para Phaser backgroundColor). */
    bg,
    /** Color del jugador local — label de nombre (hex string CSS). */
    brand,
    /** Color del jugador local — sprite rectangulo (int Phaser). */
    brandInt: cssToInt(brand),
    /** Color de peers — sprite rectangulo (int Phaser). */
    dangerInt: cssToInt(danger),
    /** Color principal de texto — label de nombre de peers (hex string CSS). */
    text,
  };
}
