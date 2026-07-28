// studioPractice.js — lógica pura del Estudio (mixer por capas, tira de práctica).
// Sin DOM ni Web Audio: consumida por MultiTrackPlayer/ToneLyrics/SongStudioView.

/**
 * Capas del mixer. Cada array interno es una partición COMPLETA del mismo
 * audio, no un trozo complementario: `vocals` es la voz entera, y
 * `lead+backing`, `male+female` y `voice_a+voice_b` son tres maneras distintas
 * de partir ESA MISMA voz (las secciones leadBacking, gender y duet del
 * separador corren todas sobre el vocal de S1, ver `api/stems/_sections.js`).
 * Lo mismo con `instrumental` frente a drums+bass+guitar+piano+other.
 *
 * Sumar dos particiones del mismo dominio reproduce la señal dos veces con
 * unas decenas de ms de desfase: filtro peine, timbre hueco y cancelaciones
 * que se perciben como cortes. Por eso el mixer es aditivo DENTRO de una
 * partición y excluyente ENTRE particiones del mismo dominio.
 */
export const TRACK_LAYERS = {
  voces: [['vocals'], ['lead', 'backing'], ['male', 'female'], ['voice_a', 'voice_b']],
  instrumentos: [['instrumental'], ['drums', 'bass', 'guitar', 'piano', 'other']],
};

const LAYER_BY_KIND = new Map();
for (const [domain, layers] of Object.entries(TRACK_LAYERS)) {
  layers.forEach((kinds, layer) => {
    for (const kind of kinds) LAYER_BY_KIND.set(kind, { domain, layer });
  });
}

/** Dominio y partición a la que pertenece un kind, o null si no está en ninguna. */
export function layerOf(kind) {
  return LAYER_BY_KIND.get(kind) ?? null;
}

/**
 * Mezcla de arranque: la partición más completa de cada dominio, es decir la
 * mezcla original de la canción (`vocals` + `instrumental` cuando existen).
 * Si un dominio no tiene su primera partición publicada, cae a la siguiente
 * que sí tenga pistas — nunca deja el dominio en silencio.
 * @param {Array<{kind?: string}>} tracks
 * @returns {Set<number>} índices activos
 */
export function defaultActiveSet(tracks) {
  const list = tracks ?? [];
  const active = new Set();
  for (const layers of Object.values(TRACK_LAYERS)) {
    const chosen = layers.find((kinds) => list.some((t) => kinds.includes(t?.kind)));
    if (!chosen) continue;
    list.forEach((t, i) => {
      if (chosen.includes(t?.kind)) active.add(i);
    });
  }
  // Pistas fuera de toda capa conocida: no participan de la exclusión y
  // arrancan encendidas, así un kind nuevo del backend nunca queda inaudible.
  list.forEach((t, i) => {
    if (!layerOf(t?.kind)) active.add(i);
  });
  return active;
}

/**
 * Togglea una pista respetando la exclusión entre particiones: encender una
 * pista expulsa a las de OTRA partición del mismo dominio (nunca suenan dos
 * descomposiciones del mismo audio a la vez), y apagarla no toca nada más.
 * @param {Set<number>} active
 * @param {number} i
 * @param {Array<{kind?: string}>} tracks
 * @returns {Set<number>} nuevo conjunto activo
 */
export function toggleTrack(active, i, tracks) {
  const next = new Set(active);
  if (next.has(i)) {
    next.delete(i);
    return next;
  }
  const target = layerOf(tracks?.[i]?.kind);
  if (target) {
    for (const j of [...next]) {
      const other = layerOf(tracks?.[j]?.kind);
      if (other && other.domain === target.domain && other.layer !== target.layer) next.delete(j);
    }
  }
  next.add(i);
  return next;
}

/** Aditivo dentro de la mezcla activa; si hay algún solo, el solo manda. */
export function isTrackAudible({ i, active, soloed }) {
  if (soloed.size > 0) return soloed.has(i);
  return active.has(i);
}

/** Línea viva "qué estoy oyendo" a partir del estado del mixer. */
export function nowSoundLabel(tracks, active, soloed) {
  const names = tracks
    .map((t, i) => ({ label: t.label, i }))
    .filter(({ i }) => isTrackAudible({ i, active, soloed }))
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
