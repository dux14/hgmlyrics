// Valida el bloque `beats` del webhook de align (rejilla de metronomo detectada
// por Modal). A diferencia de `lines`, es best-effort: invalido no tumba el
// webhook, solo se descarta (ver api/align/webhook.js).

/**
 * Valida el bloque beats del webhook de align.
 * @param {{bpm: number, beatsMs: number[]}|null|undefined} beats
 * @returns {string|null} error o null.
 */
export function validateBeats(beats) {
  if (beats === null || beats === undefined) return null;
  const { bpm, beatsMs } = beats;
  // El rango (0,400) exclusivo debe coincidir con el CHECK
  // song_line_timings_bpm_detected_check (migracion 20260711182350). Si el
  // UPDATE de exito del webhook violara ese CHECK, abortaria tambien
  // status='ready'/lines y la fila quedaria colgada en 'processing'; esta
  // validacion corta antes justamente por eso.
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm >= 400) return `bpm invalido: ${bpm}`;
  if (!Array.isArray(beatsMs) || beatsMs.length < 2) return 'beatsMs invalido';
  let prev = -1;
  for (const t of beatsMs) {
    if (!Number.isInteger(t) || t < 0 || t <= prev) {
      return `beatsMs no estrictamente creciente en ${t}`;
    }
    prev = t;
  }
  return null;
}
