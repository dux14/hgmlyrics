/**
 * studioSections.js — Constantes y helpers de presentación para las 4 secciones del Estudio DAG.
 * SECTION_KEYS es idéntico al del backend (api/stems/_sections.js) — mantenerlos sincronizados.
 */

/** Espejo del SECTION_KEYS del backend. Debe mantenerse byte-idéntico a api/stems/_sections.js. */
export const SECTION_KEYS = ['voiceInstrumental', 'structure', 'leadBacking', 'gender'];

const LABELS = {
  voiceInstrumental: 'Voz e instrumentos',
  structure: 'Secciones',
  leadBacking: 'Voz líder y coros',
  gender: 'Voces por género',
};

const STATUS_LABELS = {
  pending: 'En espera',
  running: 'Separando…',
  done: 'Listo',
  failed: 'Error',
  skipped: 'No procesada',
};

/**
 * Etiqueta en español para una clave de sección.
 * @param {string} key
 * @returns {string}
 */
export function sectionLabel(key) {
  return LABELS[key] ?? key;
}

/**
 * Estado de presentación para un objeto de sección.
 * @param {{ status: string }} section
 * @returns {{ status: string, label: string }}
 */
export function sectionState(section) {
  const status = section?.status ?? 'pending';
  return { status, label: STATUS_LABELS[status] ?? status };
}
