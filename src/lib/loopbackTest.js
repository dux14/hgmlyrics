// src/lib/loopbackTest.js
/**
 * loopbackTest.js — Auto-test de afinación: la app emite tonos conocidos y el
 * micrófono los capta; el offset (en cents) entre lo esperado y lo detectado
 * indica el desfase del dispositivo.
 *
 * `medianOffsetCents` es puro. `runLoopbackTest` orquesta tonePlayer + detector
 * y por tanto requiere audio real (verificación manual; avisar de usar altavoz).
 */
import { noteToFrequency } from './notes.js';

/**
 * Mediana de los offsets en cents de un conjunto de mediciones.
 * @param {{ expectedHz: number, detectedHz: number }[]} measurements
 * @returns {number|null} Mediana en cents, o null si no hay muestras válidas.
 */
export function medianOffsetCents(measurements) {
  const cents = (measurements || [])
    .filter((m) => m && m.expectedHz > 0 && m.detectedHz > 0)
    .map((m) => 1200 * Math.log2(m.detectedHz / m.expectedHz))
    .sort((a, b) => a - b);
  if (cents.length === 0) return null;
  const mid = Math.floor(cents.length / 2);
  return cents.length % 2 ? cents[mid] : (cents[mid - 1] + cents[mid]) / 2;
}

/**
 * Orquesta el loopback: reproduce cada nota, recoge la detección estabilizada y
 * devuelve el offset mediano. Pensado para correr en el browser (audio real).
 * @param {{
 *   tonePlayer: { play: (hz: number, ms?: number) => void, stop: () => void },
 *   sampleDetected: (hz: number) => Promise<number|null>,
 *   notes?: string[],
 *   toneMs?: number,
 * }} opts - `sampleDetected(hz)` reproduce/espera y resuelve el hz detectado
 *   para el tono pedido (lo provee Tuner.js, que tiene el detector vivo).
 * @returns {Promise<{ ok: boolean, offsetCents: number|null, detail: object[] }>}
 */
export async function runLoopbackTest({
  tonePlayer,
  sampleDetected,
  notes = ['A4', 'C4', 'E4'],
  toneMs = 1200,
}) {
  const detail = [];
  for (const label of notes) {
    const expectedHz = noteToFrequency(label);
    tonePlayer.play(expectedHz, toneMs);
    const detectedHz = await sampleDetected(expectedHz);
    tonePlayer.stop();
    detail.push({ note: label, expectedHz, detectedHz });
  }
  const offsetCents = medianOffsetCents(
    detail.map((d) => ({ expectedHz: d.expectedHz, detectedHz: d.detectedHz })),
  );
  return { ok: offsetCents !== null, offsetCents, detail };
}
