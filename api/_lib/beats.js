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

const VALID_TIME_SIGNATURES = ['4/4', '3/4', '6/8', '2/4'];

/**
 * Valida el body del PATCH de overrides de audio (bpm/compas/ancla manuales
 * del admin, ver api/songs/[id]/audio.js). Semantica de PATCH parcial:
 * - campo AUSENTE (undefined) = no tocar ese campo.
 * - campo `null` explicito = limpiar el override (volver al valor detectado).
 * - campo presente y no-null = valor nuevo, validado en rango.
 * @param {{bpmManual?: number|null, timeSignature?: string|null, beatAnchor?: number|null}|null} body
 * @returns {string|null} error o null.
 */
export function validatePatchBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return 'body invalido';
  }
  const { bpmManual, timeSignature, beatAnchor } = body;
  if (bpmManual !== undefined && bpmManual !== null) {
    // 20-350 es un rango musical razonable elegido por producto, MAS
    // ESTRICTO a propósito que el CHECK (0,400) de song_audio.bpm_manual en
    // DB — ese CHECK es solo la red de seguridad, no el limite de negocio.
    if (!Number.isFinite(bpmManual) || bpmManual < 20 || bpmManual > 350) {
      return `bpmManual invalido: ${bpmManual}`;
    }
  }
  if (timeSignature !== undefined && timeSignature !== null) {
    if (!VALID_TIME_SIGNATURES.includes(timeSignature)) {
      return `timeSignature invalido: ${timeSignature}`;
    }
  }
  if (beatAnchor !== undefined && beatAnchor !== null) {
    // beatAnchor (1-12) se valida independiente de timeSignature a proposito
    // — el ancla referencia el beat detectado por Modal que actua como "1",
    // no una posicion dentro del compas; el front la normaliza con
    // Math.min(anchor, perBar) en beatClock (FASE 4).
    if (!Number.isInteger(beatAnchor) || beatAnchor < 1 || beatAnchor > 12) {
      return `beatAnchor invalido: ${beatAnchor}`;
    }
  }
  if (bpmManual === undefined && timeSignature === undefined && beatAnchor === undefined) {
    return 'sin campos para actualizar';
  }
  return null;
}

/**
 * Valida el shape del campo lineTiming del PATCH de audio (correccion manual
 * del startMs de UNA linea, ver api/songs/[id]/audio.js). Solo shape: la
 * existencia de la linea y la monotonicidad contra vecinas se validan en el
 * endpoint (necesitan la fila de song_line_timings).
 * @param {{i?: number, startMs?: number}|null|undefined} lineTiming
 * @returns {string|null} error o null.
 */
export function validateLineTimingShape(lineTiming) {
  if (lineTiming === null || typeof lineTiming !== 'object' || Array.isArray(lineTiming)) {
    return 'lineTiming: body invalido';
  }
  const { i, startMs } = lineTiming;
  if (!Number.isInteger(i) || i < 0) return `lineTiming: i invalido: ${i}`;
  if (!Number.isInteger(startMs) || startMs < 0) {
    return `lineTiming: startMs invalido: ${startMs}`;
  }
  return null;
}
