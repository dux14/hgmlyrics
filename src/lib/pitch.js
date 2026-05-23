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
 * Debug mode: opts.onEvent (optional) receives every state transition for
 * diagnostic UI. Use controller.getDebugState() for current snapshot and
 * controller.setTestTone(bool) to swap the mic stream for a 440Hz oscillator
 * (decouples "mic dead" from "detector dead").
 *
 * @param {{
 *   onPitch: (info: { hz: number | null, rms: number }) => void,
 *   onError?: (err: Error) => void,
 *   onState?: (state: 'requesting' | 'running' | 'stopped' | 'denied') => void,
 *   onEvent?: (ev: { type: string, data?: object }) => void,
 *   fftSize?: number,
 *   intervalMs?: number,
 * }} opts
 */
export function createPitchDetector(opts) {
  const { onPitch, onError = () => {}, onState = () => {}, onEvent = null } = opts;
  const fftSize = opts.fftSize ?? 2048;
  const intervalMs = opts.intervalMs ?? 33;

  let ctx = null;
  let stream = null;
  let analyser = null;
  let micSource = null;
  let silentGain = null;
  let oscNode = null;
  let rafId = null;
  let lastEmit = 0;
  let running = false;
  let buffer = null;
  let lastRms = null;
  let lastHz = null;
  const events = [];

  function emit(type, data) {
    const ev = { t: Math.round(performance.now()), type, data: data ?? null };
    events.push(ev);
    if (events.length > 50) events.shift();
    if (onEvent) onEvent(ev);
  }

  function reportErr(step, e) {
    const msg = e && e.message ? e.message : String(e);
    const err = new Error(`[${step}] ${msg}`);
    emit('error', { step, message: msg });
    onError(err);
  }

  async function start() {
    if (running) return;
    onState('requesting');
    emit('user-gesture-start');

    try {
      emit('gum-call', {
        constraints: {
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        },
      });
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const t0 = stream.getAudioTracks()[0];
      emit('gum-success', {
        tracks: stream.getAudioTracks().map((t) => ({
          label: t.label,
          kind: t.kind,
          readyState: t.readyState,
          muted: t.muted,
        })),
      });
      if (t0) {
        t0.onmute = () => emit('track-mute', { muted: t0.muted });
        t0.onunmute = () => emit('track-unmute', { muted: t0.muted });
        t0.onended = () => emit('track-ended');
      }
    } catch (e) {
      onState('denied');
      reportErr('getUserMedia', e);
      return;
    }

    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      emit('ctx-created', { state: ctx.state, sampleRate: ctx.sampleRate });
    } catch (e) {
      reportErr('AudioContext-ctor', e);
      return;
    }

    try {
      if (ctx.state === 'suspended') {
        emit('resume-1-call');
        await ctx.resume();
        emit('resume-1-result', { state: ctx.state });
      }
    } catch (e) {
      reportErr('resume-1', e);
      return;
    }

    try {
      micSource = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = 0;
      // iOS Safari quirk: AnalyserNode only processes audio when the graph
      // terminates at `ctx.destination`. Without this, getFloatTimeDomainData
      // returns silent buffers on iPhone (Safari, Chrome iOS, PWA standalone).
      // The silent gain prevents feedback while keeping the graph alive.
      silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      micSource.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(ctx.destination);
      emit('graph-connected', { ctxState: ctx.state });
    } catch (e) {
      reportErr('graph-build', e);
      return;
    }

    try {
      // Some iOS builds keep ctx suspended until after connect(); re-resume.
      if (ctx.state === 'suspended') {
        emit('resume-2-call');
        await ctx.resume();
        emit('resume-2-result', { state: ctx.state });
      }
    } catch (e) {
      reportErr('resume-2', e);
      return;
    }

    buffer = new Float32Array(analyser.fftSize);
    running = true;
    onState('running');
    emit('tick-loop-start');

    const tick = () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastEmit >= intervalMs) {
        lastEmit = now;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        lastRms = rms;
        const hz = detectPitch(buffer, ctx.sampleRate);
        lastHz = hz;
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
    if (oscNode) {
      try {
        oscNode.stop();
      } catch (_) {
        /* already stopped */
      }
      oscNode.disconnect();
      oscNode = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
    analyser = null;
    micSource = null;
    silentGain = null;
    buffer = null;
    emit('stopped');
    onState('stopped');
  }

  function getDebugState() {
    const track = stream?.getAudioTracks()[0] ?? null;
    return {
      ctxState: ctx?.state ?? null,
      sampleRate: ctx?.sampleRate ?? null,
      streamActive: stream?.active ?? null,
      track: track
        ? { readyState: track.readyState, muted: track.muted, label: track.label }
        : null,
      lastRms,
      lastHz,
      events: events.slice(),
    };
  }

  function setTestTone(enabled) {
    if (!ctx || !analyser) return;
    if (enabled && !oscNode) {
      try {
        micSource?.disconnect();
      } catch (_) {
        /* not connected */
      }
      oscNode = ctx.createOscillator();
      oscNode.frequency.value = 440;
      oscNode.connect(analyser);
      oscNode.start();
      emit('test-tone-on');
    } else if (!enabled && oscNode) {
      try {
        oscNode.stop();
      } catch (_) {
        /* already stopped */
      }
      oscNode.disconnect();
      oscNode = null;
      try {
        micSource?.connect(analyser);
      } catch (_) {
        /* analyser gone */
      }
      emit('test-tone-off');
    }
  }

  return {
    start,
    stop,
    isRunning: () => running,
    getDebugState,
    setTestTone,
  };
}
