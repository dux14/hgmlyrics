/**
 * sectionTypes.js — normalización de `section.type` a un slug/etiqueta fijos.
 * Compartido por SongView.js (Lector) y StageMode.js (escenario): antes cada
 * uno tenía su propia copia (StageMode duplicaba a propósito para evitar un
 * ciclo import SongView↔StageMode); vive aquí porque ninguno de los dos
 * necesita importar al otro para usarlo.
 */

/** Slugs de sección con identidad visual fija (spec F1 D1 §3). */
export const KNOWN_SECTION_TYPES = ['verse', 'chorus', 'bridge', 'prechorus', 'intro', 'outro'];

/** Sinónimos español/legacy → slug conocido, para datos que no pasaron por guessType(). */
export const SECTION_TYPE_ALIASES = {
  verso: 'verse',
  estribillo: 'chorus',
  coro: 'chorus',
  puente: 'bridge',
  'pre-estribillo': 'prechorus',
  'pre-coro': 'prechorus',
  precoro: 'prechorus',
};

/** Etiqueta en español por slug (usada por el label de sección del escenario). */
export const SECTION_TYPE_LABELS = {
  verse: 'VERSO',
  chorus: 'CORO',
  bridge: 'PUENTE',
  prechorus: 'PRE-CORO',
  intro: 'INTRO',
  outro: 'OUTRO',
};

/**
 * Normaliza `section.type` a uno de los 6 slugs conocidos, para poder pintar
 * la identidad visual fija por tipo. Tipos desconocidos caen a 'verse'.
 * @param {string} [type]
 * @returns {string}
 */
export function normalizeSectionType(type) {
  const slug = (type || '').toString().trim().toLowerCase();
  if (KNOWN_SECTION_TYPES.includes(slug)) return slug;
  return SECTION_TYPE_ALIASES[slug] || 'verse';
}
