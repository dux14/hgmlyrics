/**
 * pitch.js — Real-time monophonic pitch detection via YIN.
 *
 * La lógica DSP pura vive en `pitchCore.js` (sin DOM ni Web Audio).
 * `createPitchDetector` conecta MediaStream → AudioWorklet (con fallback a
 * AnalyserNode) y emite pitches a ~30 Hz.
 *
 * No external deps. Single-window analysis (~46 ms @ 44.1 kHz / 2048).
 */

import { detectPitch } from './pitchCore.js';
export { detectPitch } from './pitchCore.js';

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
  let workletNode = null;

  async function start() {
    if (running) return;
    onState('requesting');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false },
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

    // Camino moderno: YIN en el hilo de audio. Si falla, fallback a AnalyserNode.
    if (ctx.audioWorklet && typeof globalThis.AudioWorkletNode === 'function') {
      try {
        await ctx.audioWorklet.addModule(new URL('./pitchWorklet.js', import.meta.url));
        workletNode = new globalThis.AudioWorkletNode(ctx, 'yin-processor', {
          processorOptions: { fftSize, intervalMs },
        });
        workletNode.port.onmessage = (e) => onPitch(e.data);
        // Mantener vivo el grafo (quirk iOS) con una ganancia silenciosa.
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        source.connect(workletNode);
        workletNode.connect(silentGain);
        silentGain.connect(ctx.destination);
        if (ctx.state === 'suspended') await ctx.resume();
        running = true;
        onState('running');
        return;
      } catch (e) {
        console.warn('[tuner] AudioWorklet no disponible, usando AnalyserNode:', e);
        if (workletNode) {
          workletNode.disconnect();
          workletNode = null;
        }
      }
    }

    startWithAnalyser(source);
  }

  function startWithAnalyser(source) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    // iOS Safari quirk: AnalyserNode only processes audio when the graph
    // terminates at `ctx.destination`. Without this, getFloatTimeDomainData
    // returns silent buffers on iPhone (Safari, Chrome iOS, PWA standalone).
    // The silent gain prevents feedback while keeping the graph alive.
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(ctx.destination);
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
        onPitch({ hz: hz !== null ? hz : null, rms });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
      workletNode = null;
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
    buffer = null;
    onState('stopped');
  }

  return { start, stop, isRunning: () => running };
}

/**
 * Decide si arrancar el micrófono sin pedir un tap, según el estado del permiso
 * (resultado de navigator.permissions.query({ name: 'microphone' }).state).
 * @param {string} permissionState
 * @returns {boolean} true solo si el permiso ya está concedido.
 */
export function shouldAutoStartMic(permissionState) {
  return permissionState === 'granted';
}
