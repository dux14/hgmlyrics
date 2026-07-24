/**
 * structureLabels.js — helpers puros de etiqueta/color para segmentos de
 * `song_structure` (SongFormer). Extraído de StructureDetail.js (Task 5,
 * sub-paso 0) para reutilizarlo en ToneLyrics.js sin arrastrar el resto del
 * componente (editor admin, PATCH, etc).
 */

// Label de SongFormer -> slug de color de sección. Mapeo EXPLÍCITO (no
// normalizeSectionType/sectionTypes.js): ese normalizador cae en 'verse'
// para cualquier tipo que no reconoce (fallback pensado para datos de letra,
// no para SongFormer), y 'instrumental'/'silencio' terminarían con el color
// de verso por COINCIDENCIA (hoy ambos son neutros) en vez de por intención.
// Acá 'instrumental'/'silencio' (y cualquier label inesperado) van directo a
// 'neutral' (--color-section-neutral, review Task 16 Minor 1).
export const LABEL_TO_SECTION_SLUG = {
  intro: 'intro',
  verso: 'verse',
  coro: 'chorus',
  puente: 'bridge',
  instrumental: 'neutral',
  outro: 'outro',
  silencio: 'neutral',
  'pre-coro': 'prechorus',
};

export function sectionColorSlug(label) {
  return LABEL_TO_SECTION_SLUG[String(label || '').toLowerCase()] || 'neutral';
}

export function displayLabel(label) {
  const s = String(label || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
