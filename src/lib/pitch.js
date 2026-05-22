/**
 * pitch.js — Real-time monophonic pitch detection via YIN.
 *
 * Pure DSP in `detectPitch` (testable). `createPitchDetector` wires a
 * MediaStream → AnalyserNode → requestAnimationFrame loop and emits
 * pitches at ~30 Hz.
 *
 * No external deps. Single-window analysis (~46 ms @ 44.1 kHz / 2048).
 *
 * References:
 *   - de Cheveigné & Kawahara (2002), "YIN, a fundamental frequency
 *     estimator for speech and music." J. Acoust. Soc. Am. 111(4).
 */

const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_MIN_HZ = 60; // below human bass + below E2 (82Hz) with margin
const DEFAULT_MAX_HZ = 1500; // above E6; covers human voice + guitar

/**
 * Detect the fundamental frequency in a buffer.
 * Returns `null` when no confident pitch is found (silence / inharmonic).
 *
 * @param {Float32Array|number[]} buffer Mono audio samples in [-1, 1].
 * @param {number} sampleRate
 * @param {{ threshold?: number, minHz?: number, maxHz?: number }} [opts]
 * @returns {number | null} Frequency in Hz, or null.
 */
export function detectPitch(buffer, sampleRate, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const minHz = opts.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = opts.maxHz ?? DEFAULT_MAX_HZ;
  const N = buffer.length;
  if (N < 64 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;

  // RMS gate: skip near-silent buffers.
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / N);
  if (rms < 0.01) return null;

  const halfN = Math.floor(N / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(halfN - 1, Math.floor(sampleRate / minHz));
  if (tauMax <= tauMin) return null;

  // 1. Difference function d(tau)
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < halfN; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  // 2. Cumulative mean normalized difference d'(tau)
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau];
    cmnd[tau] = (d[tau] * tau) / (runningSum || 1);
  }

  // 3. Absolute threshold — find smallest tau where cmnd < threshold,
  //    then descend into its local minimum.
  let tauEstimate = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0) return null;

  // 4. Parabolic interpolation for sub-sample precision.
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
 * Create a live pitch detector. Returns a controller with `start()`/`stop()`.
 * - Requires a secure context with `navigator.mediaDevices.getUserMedia`.
 * - AudioContext is created lazily inside `start()` so it can run in
 *   response to a user gesture (iOS Safari requirement).
 *
 * @param {{
 *   onPitch: (info: { hz: number, rms: number }) => void,
 *   onError?: (err: Error) => void,
 *   onState?: (state: 'requesting' | 'running' | 'stopped' | 'denied') => void,
 *   fftSize?: number,
 *   intervalMs?: number,
 * }} opts
 * @returns {{ start: () => Promise<void>, stop: () => void, isRunning: () => boolean }}
 */
export function createPitchDetector(opts) {
  const { onPitch, onError = () => {}, onState = () => {} } = opts;
  const fftSize = opts.fftSize ?? 2048;
  const intervalMs = opts.intervalMs ?? 33;

  let ctx = null;
  let stream = null;
  let analyser = null;
  let rafId = null;
  let lastEmit = 0;
  let running = false;
  let buffer = null;

  async function start() {
    if (running) return;
    onState('requesting');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e) {
      onState('denied');
      onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    buffer = new Float32Array(analyser.fftSize);

    running = true;
    onState('running');
    const tick = () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastEmit >= intervalMs) {
        lastEmit = now;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        const hz = detectPitch(buffer, ctx.sampleRate);
        if (hz !== null) onPitch({ hz, rms });
        else onPitch({ hz: null, rms });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
    analyser = null;
    buffer = null;
    onState('stopped');
  }

  return { start, stop, isRunning: () => running };
}
