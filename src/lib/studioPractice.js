// studioPractice.js — lógica pura del Estudio (mixer C, tira de práctica).
// Sin DOM ni Web Audio: consumida por MultiTrackPlayer/ToneLyrics/SongStudioView.

/** Modelo C: aditivo por defecto; si hay algún solo, el solo manda. */
export function isTrackAudible({ i, disabled, soloed }) {
  if (soloed.size > 0) return soloed.has(i);
  return !disabled.has(i);
}

/** Línea viva "qué estoy oyendo" a partir del estado del mixer. */
export function nowSoundLabel(tracks, disabled, soloed) {
  const names = tracks
    .map((t, i) => ({ label: t.label, i }))
    .filter(({ i }) => isTrackAudible({ i, disabled, soloed }))
    .map(({ label }) => label);
  return names.length ? `Sonando: ${names.join(' + ')}` : 'Nada sonando';
}

/** Índice del segmento de song_structure que contiene lineStartSec, o -1. */
export function lineSegmentIndex(lineStartSec, segments) {
  const ms = lineStartSec * 1000;
  return (segments ?? []).findIndex((s) => ms >= s.startMs && ms < s.endMs);
}

/** Si el loop está activo y el tiempo pasó endMs, retorna el destino del seek (s); si no, null. */
export function loopSeekTarget(masterTimeSec, segment) {
  if (!segment) return null;
  return masterTimeSec * 1000 >= segment.endMs ? segment.startMs / 1000 : null;
}
