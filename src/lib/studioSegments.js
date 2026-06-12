/**
 * studioSegments.js — Helpers puros para la línea de tiempo de voces del Estudio.
 */

const VOICE_COLORS = [
  'var(--color-voice-soprano)',
  'var(--color-voice-contralto)',
  'var(--color-voice-tenor)',
  'var(--color-voice-bass)',
];

/**
 * Fusiona segmentos contiguos del MISMO cantante separados por un hueco < maxGapS.
 * @param {{voice:string,start:number,end:number}[]} segments
 * @param {{maxGapS?:number}} [opts]
 * @returns {{voice:string,start:number,end:number}[]}
 */
export function mergeSegments(segments, { maxGapS = 0.4 } = {}) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const out = [];
  for (const seg of sorted) {
    const last = out[out.length - 1];
    if (last && last.voice === seg.voice && seg.start - last.end < maxGapS) {
      last.end = Math.max(last.end, seg.end);
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

/**
 * Posición de un segmento como porcentajes left/width sobre la duración total.
 * @returns {{left:number,width:number}}
 */
export function segmentToPct(seg, durationS) {
  if (!durationS || durationS <= 0) return { left: 0, width: 0 };
  const left = Math.min(100, Math.max(0, (seg.start / durationS) * 100));
  const right = Math.min(100, Math.max(0, (seg.end / durationS) * 100));
  return { left, width: Math.max(0, right - left) };
}

/**
 * Var CSS de color para un label de sección estructural (SongFormer).
 * @param {string} label  uno de: intro|verso|coro|puente|instrumental|outro|silencio|pre-coro
 * @returns {string}  var(--color-*)
 */
export function labelColor(label) {
  switch (label) {
    case 'verso':        return 'var(--color-primary)';
    case 'coro':         return 'var(--color-accent)';
    case 'puente':       return 'var(--color-voice-contralto)';
    case 'instrumental': return 'var(--color-voice-bass)';
    case 'pre-coro':     return 'var(--color-primary-light)';
    case 'intro':
    case 'outro':
    case 'silencio':
    default:             return 'var(--color-text-secondary)';
  }
}

/**
 * Var CSS de color estable para un cantante, según su orden de aparición.
 * @param {string} voice
 * @param {string[]} order  lista ordenada de nombres de voz únicos
 */
export function voiceColorVar(voice, order) {
  const idx = order.indexOf(voice);
  const safe = idx < 0 ? 0 : idx;
  return VOICE_COLORS[safe % VOICE_COLORS.length];
}
