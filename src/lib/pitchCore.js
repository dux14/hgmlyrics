/**
 * pitchCore.js — DSP puro del afinador (sin DOM ni Web Audio).
 * Importado por pitch.js (camino AnalyserNode) y por pitchWorklet.js (hilo de audio).
 *
 * Referencia: de Cheveigné & Kawahara (2002), "YIN, a fundamental frequency
 * estimator for speech and music." J. Acoust. Soc. Am. 111(4).
 */

const DEFAULT_MIN_HZ = 60;
const DEFAULT_MAX_HZ = 1100;
const DEFAULT_RMS_GATE = 0.005;
// pYIN-lite: en vez de un único threshold, se prueban varios y se queda con
// el candidato de mayor confianza (menos propenso a saltos de octava que YIN clásico).
const THRESHOLDS = [0.1, 0.15, 0.2];
// Fallback cuando ningún threshold encuentra candidato (voz aireada/susurrada):
// se acepta el mínimo global del CMNDF si es razonablemente confiable.
const FALLBACK_CMND_MAX = 0.35;

/**
 * Busca, a partir de tauMin, el primer mínimo local del CMNDF por debajo de
 * `threshold` (heurística de YIN: descender mientras siga bajando).
 * @param {Float32Array} cmnd
 * @param {number} tauMin
 * @param {number} tauMax
 * @param {number} threshold
 * @returns {number} tau encontrado, o -1 si ninguno cae bajo el threshold.
 */
function findFirstLocalMinBelow(cmnd, tauMin, tauMax, threshold) {
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      return tau;
    }
  }
  return -1;
}

/**
 * Refina un tau entero a una estimación sub-muestra por interpolación parabólica
 * de los 3 puntos del CMNDF alrededor del mínimo.
 * @param {Float32Array} cmnd
 * @param {number} tauEstimate
 * @param {number} tauMax
 * @returns {number} tau refinado (puede tener parte fraccionaria).
 */
function parabolicInterpolate(cmnd, tauEstimate, tauMax) {
  let betterTau = tauEstimate;
  const x0 = tauEstimate > 0 ? cmnd[tauEstimate - 1] : cmnd[tauEstimate];
  const x1 = cmnd[tauEstimate];
  const x2 = tauEstimate < tauMax ? cmnd[tauEstimate + 1] : cmnd[tauEstimate];
  const denom = x0 + x2 - 2 * x1;
  if (Math.abs(denom) > 1e-9) {
    const shift = (x0 - x2) / (2 * denom);
    if (Math.abs(shift) < 1) betterTau = tauEstimate + shift;
  }
  return betterTau;
}

/**
 * Detecta la frecuencia fundamental en un buffer, con confianza asociada.
 * Variante "pYIN-lite": evalúa varios thresholds del CMNDF y se queda con el
 * candidato de mayor confianza en vez de aceptar el primero que cruce un único
 * threshold — reduce saltos de octava frente a armónicos dominantes.
 * @param {Float32Array|number[]} buffer Muestras mono en [-1, 1].
 * @param {number} sampleRate
 * @param {{ minHz?: number, maxHz?: number, rmsGate?: number }} [opts]
 * @returns {{ hz: number, confidence: number } | null}
 */
export function detectPitchDetailed(buffer, sampleRate, opts = {}) {
  const minHz = opts.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = opts.maxHz ?? DEFAULT_MAX_HZ;
  const rmsGate = opts.rmsGate ?? DEFAULT_RMS_GATE;
  const N = buffer.length;
  if (N < 64 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;

  let rms = 0;
  for (let i = 0; i < N; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / N);
  if (rms < rmsGate) return null;

  const halfN = Math.floor(N / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(halfN - 1, Math.floor(sampleRate / minHz));
  if (tauMax <= tauMin) return null;

  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < halfN; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau];
    cmnd[tau] = (d[tau] * tau) / (runningSum || 1);
  }

  let bestTau = -1;
  let bestConfidence = -1;
  for (const threshold of THRESHOLDS) {
    const tau = findFirstLocalMinBelow(cmnd, tauMin, tauMax, threshold);
    if (tau < 0) continue;
    const confidence = 1 - cmnd[tau];
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestTau = tau;
    }
  }

  if (bestTau < 0) {
    // ningún threshold cruzó: cae al mínimo global del CMNDF si es aceptable.
    let minTau = -1;
    let minVal = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < minVal) {
        minVal = cmnd[tau];
        minTau = tau;
      }
    }
    if (minTau < 0 || minVal >= FALLBACK_CMND_MAX) return null;
    bestTau = minTau;
    bestConfidence = 1 - minVal;
  }

  const betterTau = parabolicInterpolate(cmnd, bestTau, tauMax);
  return { hz: sampleRate / betterTau, confidence: bestConfidence };
}

/**
 * Detecta la frecuencia fundamental en un buffer. null si no hay pitch confiable.
 * Wrapper de compatibilidad sobre `detectPitchDetailed` (solo hz, sin confidence).
 * @param {Float32Array|number[]} buffer Muestras mono en [-1, 1].
 * @param {number} sampleRate
 * @param {{ minHz?: number, maxHz?: number, rmsGate?: number }} [opts]
 * @returns {number | null} Frecuencia en Hz, o null.
 */
export function detectPitch(buffer, sampleRate, opts = {}) {
  const result = detectPitchDetailed(buffer, sampleRate, opts);
  return result ? result.hz : null;
}

/**
 * Calcula RMS y pitch (con confianza) de un buffer en una sola pasada de conveniencia.
 * Reporta rms SIEMPRE (incluso si hz es null), igual que el tick actual.
 * @param {Float32Array|number[]} buffer
 * @param {number} sampleRate
 * @param {object} [opts] - mismas opciones que detectPitchDetailed
 * @returns {{ hz: number|null, rms: number, confidence: number }}
 */
export function analyzeBuffer(buffer, sampleRate, opts = {}) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = buffer.length ? Math.sqrt(sum / buffer.length) : 0;
  const result = detectPitchDetailed(buffer, sampleRate, opts);
  return { hz: result ? result.hz : null, rms, confidence: result ? result.confidence : 0 };
}

/**
 * Acumula frames de tamaño arbitrario (el worklet entrega 128 muestras) en
 * ventanas no solapadas de `fftSize`. Devuelve una COPIA de la ventana cuando
 * se llena, o null mientras acumula.
 * @param {number} fftSize
 * @returns {{ push: (frame: Float32Array|number[]) => Float32Array|null, reset: () => void }}
 */
export function createWindower(fftSize) {
  const buf = new Float32Array(fftSize);
  let filled = 0;
  return {
    push(frame) {
      let out = null;
      for (let i = 0; i < frame.length; i++) {
        buf[filled++] = frame[i];
        if (filled >= fftSize) {
          out = buf.slice(0);
          filled = 0;
        }
      }
      return out;
    },
    reset() {
      filled = 0;
    },
  };
}

/**
 * Ring buffer de `fftSize` muestras que expone ventanas SOLAPADAS: cada `hop`
 * muestras nuevas acumuladas (una vez alcanzado `fftSize` al menos una vez),
 * devuelve la ventana completa con las últimas `fftSize` muestras en orden
 * temporal correcto. Es el equivalente de un STFT clásico (p.ej. fftSize 2048 /
 * hop 512 → solapamiento 4x) sin subir la tasa de mensajes del consumidor,
 * que sigue agregando entre emisiones.
 *
 * A diferencia de `createWindower`, la ventana devuelta es un buffer scratch
 * REUTILIZADO entre llamadas (sin allocaciones por push): el consumidor debe
 * leerla sincrónicamente antes del siguiente `push`, nunca retenerla ni
 * encolarla — el siguiente `push` la sobreescribe.
 *
 * Si un único `push` acumula muestras suficientes para cruzar varios hops
 * (frame de entrada mayor que `hop`), solo se devuelve la ventana del último
 * hop cruzado; las intermedias no se conservan (no hay backlog que vaciar).
 * En el worklet los frames son de 128 muestras y `hop` es múltiplo de 128,
 * así que en la práctica se cruza como mucho un hop por `push`.
 *
 * @param {number} fftSize Tamaño de la ventana.
 * @param {number} hop Muestras nuevas entre cada ventana emitida.
 * @returns {{ push: (frame: Float32Array|number[]) => Float32Array|null, reset: () => void }}
 */
export function createOverlapWindower(fftSize, hop) {
  const ring = new Float32Array(fftSize);
  const scratch = new Float32Array(fftSize);
  let writePos = 0;
  let filled = false;
  let newSinceEmit = 0;
  return {
    push(frame) {
      let out = null;
      for (let i = 0; i < frame.length; i++) {
        ring[writePos] = frame[i];
        writePos++;
        if (writePos === fftSize) {
          writePos = 0;
          filled = true; // dio la vuelta completa: ya hay fftSize muestras acumuladas
        }
        newSinceEmit++;
        if (filled && newSinceEmit >= hop) {
          // la muestra más vieja de la ventana es la próxima a sobreescribir (writePos).
          let idx = writePos;
          for (let j = 0; j < fftSize; j++) {
            scratch[j] = ring[idx];
            idx++;
            if (idx === fftSize) idx = 0;
          }
          out = scratch;
          newSinceEmit = 0;
        }
      }
      return out;
    },
    reset() {
      writePos = 0;
      filled = false;
      newSinceEmit = 0;
    },
  };
}
