/**
 * StudioPlayer.js — Reproductor propio del Estudio con scrubber de precisión.
 * Las funciones de tiempo/scrubber/lupa son puras y testeables; el factory
 * createStudioPlayer cablea un <audio> y no se testea en jsdom.
 */
import { icon } from '../lib/icons.js';

const MAG_WINDOW_S = 3; // lupa ±3 s
const LONGPRESS_MS = 400;

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Tiempo en formato m:ss.cs (centésimas). */
export function fmtTimeCs(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** ratio 0..1 → segundos, acotado a [0,duration]. */
export function posToTime(ratio, duration) {
  if (!(duration > 0)) return 0;
  return clamp(ratio, 0, 1) * duration;
}

/** segundos → ratio 0..1, acotado. */
export function timeToPos(time, duration) {
  if (!(duration > 0)) return 0;
  return clamp(time / duration, 0, 1);
}

/** Rango [start,end] de la lupa: ±windowS alrededor de time, acotado. */
export function magnifyRange(time, duration, windowS = MAG_WINDOW_S) {
  if (!(duration > 0)) return { start: 0, end: 0 };
  return { start: clamp(time - windowS, 0, duration), end: clamp(time + windowS, 0, duration) };
}

/** ratio 0..1 dentro de la lupa → segundos del rango. */
export function magnifyPosToTime(ratio, range) {
  return range.start + clamp(ratio, 0, 1) * (range.end - range.start);
}
