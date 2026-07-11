// Valida el bloque `beats` del webhook de align (rejilla de metronomo detectada
// por Modal). A diferencia de `lines`, es best-effort: invalido no tumba el
// webhook, solo se descarta (ver api/align/webhook.js).

/** Valida el bloque beats del webhook de align. @returns {string|null} error o null. */
export function validateBeats(beats) {
  if (beats === null || beats === undefined) return null;
  const { bpm, beatsMs } = beats;
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm >= 400) return `bpm invalido: ${bpm}`;
  if (!Array.isArray(beatsMs) || beatsMs.length < 2) return 'beatsMs invalido';
  let prev = -1;
  for (const t of beatsMs) {
    if (!Number.isInteger(t) || t < 0 || t <= prev)
      return `beatsMs no estrictamente creciente en ${t}`;
    prev = t;
  }
  return null;
}
