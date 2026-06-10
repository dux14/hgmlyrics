/**
 * pitchCore.js — DSP puro del afinador (sin DOM ni Web Audio).
 * Importado por pitch.js (camino AnalyserNode) y por pitchWorklet.js (hilo de audio).
 *
 * Referencia: de Cheveigné & Kawahara (2002), "YIN, a fundamental frequency
 * estimator for speech and music." J. Acoust. Soc. Am. 111(4).
 */

const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_MIN_HZ = 60;
const DEFAULT_MAX_HZ = 1500;
const DEFAULT_RMS_GATE = 0.005;

/**
 * Detecta la frecuencia fundamental en un buffer. null si no hay pitch confiable.
 * @param {Float32Array|number[]} buffer Muestras mono en [-1, 1].
 * @param {number} sampleRate
 * @param {{ threshold?: number, minHz?: number, maxHz?: number, rmsGate?: number }} [opts]
 * @returns {number | null} Frecuencia en Hz, o null.
 */
export function detectPitch(buffer, sampleRate, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
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

  let tauEstimate = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0) return null;

  let betterTau = tauEstimate;
  const x0 = tauEstimate > 0 ? cmnd[tauEstimate - 1] : cmnd[tauEstimate];
  const x1 = cmnd[tauEstimate];
  const x2 = tauEstimate < tauMax ? cmnd[tauEstimate + 1] : cmnd[tauEstimate];
  const denom = x0 + x2 - 2 * x1;
  if (Math.abs(denom) > 1e-9) {
    const shift = (x0 - x2) / (2 * denom);
    if (Math.abs(shift) < 1) betterTau = tauEstimate + shift;
  }

  return sampleRate / betterTau;
}

/**
 * Calcula RMS y pitch de un buffer en una sola pasada de conveniencia.
 * Reporta rms SIEMPRE (incluso si hz es null), igual que el tick actual.
 * @param {Float32Array|number[]} buffer
 * @param {number} sampleRate
 * @param {object} [opts] - mismas opciones que detectPitch
 * @returns {{ hz: number|null, rms: number }}
 */
export function analyzeBuffer(buffer, sampleRate, opts = {}) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = buffer.length ? Math.sqrt(sum / buffer.length) : 0;
  const hz = detectPitch(buffer, sampleRate, opts);
  return { hz, rms };
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
