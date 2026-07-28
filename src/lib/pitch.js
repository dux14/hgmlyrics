/**
 * pitch.js — Real-time monophonic pitch detection via YIN.
 *
 * La lógica DSP pura vive en `pitchCore.js` (sin DOM ni Web Audio).
 * `createPitchDetector` conecta MediaStream → AudioWorklet (con fallback a
 * AnalyserNode) y emite pitches a ~30 Hz.
 *
 * No external deps. Single-window analysis (~46 ms @ 44.1 kHz / 2048).
 */

import { detectPitchDetailed } from './pitchCore.js';
export { detectPitch } from './pitchCore.js';

// AGC/EC/NS desactivados: el AGC del celular bombea la ganancia y degrada el
// RMS gate y la confianza del detector; channelCount 1 evita el downmix
// estéreo que a veces cancela fase. Chromium tiene bugs donde estos "off" no
// se aplican de verdad (de ahí el log de settings reales en start()).
const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
};

// Gracia tras volver a foreground antes de decidir si el mic quedó muerto:
// da tiempo a que iOS reporte readyState/muted actualizados.
const RECOVERY_GRACE_MS = 300;

/**
 * Create a live pitch detector. Returns a controller with `start()`/`stop()`.
 * - Requires a secure context with `navigator.mediaDevices.getUserMedia`.
 * - AudioContext is created lazily inside `start()` so it can run in
 *   response to a user gesture (iOS Safari requirement).
 * - Auto-recupera el micrófono si el SO lo suspende o mata al pasar la app
 *   a background (frecuente en iOS Safari, que además usa el estado no
 *   estándar 'interrupted' en el AudioContext).
 *
 * @param {{
 *   onPitch: (info: { hz: number, rms: number, confidence: number }) => void,
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
  // Guardia anti-reentrada de recover() y bandera para "recupera al volver".
  let recovering = false;
  let needsRecovery = false;
  let recoveryTimer = null;

  async function start() {
    if (running) return;
    onState('requesting');
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (e) {
      onState('denied');
      onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    // Diagnóstico: qué aplicó realmente el navegador (Chromium a veces ignora los "off").
    const settings = stream.getAudioTracks?.()?.[0]?.getSettings?.();
    // eslint-disable-next-line no-console -- diagnóstico intencional de captura
    console.info('[tuner] mic settings:', settings);

    await setupAudioGraph(stream);
    attachRecoveryListeners();
  }

  /**
   * Arma el grafo de Web Audio a partir de un MediaStream ya concedido:
   * AudioContext → source → highpass → (worklet | analyser fallback).
   * Reutilizable por `start()` y por `recover()` tras recuperar el mic.
   */
  async function setupAudioGraph(mediaStream) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(mediaStream);

    // High-pass a 75 Hz: quita retumbe/DC/ruido de manipulación del teléfono
    // que contamina el CMNDF en graves, en ambos caminos (worklet y analyser).
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 75;
    highpass.Q.value = 0.707;
    source.connect(highpass);

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
        highpass.connect(workletNode);
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

    startWithAnalyser(highpass);
  }

  function startWithAnalyser(highpass) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    // iOS Safari quirk: AnalyserNode only processes audio when the graph
    // terminates at `ctx.destination`. Without this, getFloatTimeDomainData
    // returns silent buffers on iPhone (Safari, Chrome iOS, PWA standalone).
    // The silent gain prevents feedback while keeping the graph alive.
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    highpass.connect(analyser);
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
        const result = detectPitchDetailed(buffer, ctx.sampleRate);
        onPitch({ hz: result?.hz ?? null, rms, confidence: result?.confidence ?? 0 });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  /**
   * Suelta SOLO los recursos de audio (worklet/analyser/rAF/stream/ctx) sin
   * tocar `running` ni emitir 'stopped'. Lo usan tanto `stop()` como
   * `recover()` (que necesita desarmar el grafo viejo antes de rearmarlo).
   */
  function releaseAudioGraph() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
      workletNode = null;
    }
    if (stream) {
      const track = stream.getAudioTracks?.()?.[0];
      if (track) track.removeEventListener('ended', handleTrackEnded);
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
    analyser = null;
    buffer = null;
  }

  function handleTrackEnded() {
    if (!running || recovering) return;
    if (document.visibilityState === 'visible') {
      recover();
    } else {
      // Página oculta: no hay contexto de usuario para re-pedir el mic
      // (ni falta que hace). Se resuelve al volver a foreground.
      needsRecovery = true;
    }
  }

  function handleVisibilityChange() {
    if (!running || recovering) return;
    if (document.visibilityState !== 'visible') return;
    // Cubre 'suspended' y el estado no estándar 'interrupted' de iOS Safari.
    if (ctx && ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }
    if (recoveryTimer !== null) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (!running || recovering) return;
      const track = stream?.getAudioTracks?.()?.[0];
      const trackDead = Boolean(track) && (track.readyState === 'ended' || track.muted === true);
      if (trackDead || needsRecovery) recover();
    }, RECOVERY_GRACE_MS);
  }

  function attachRecoveryListeners() {
    const track = stream?.getAudioTracks?.()?.[0];
    if (track) track.addEventListener('ended', handleTrackEnded);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handleVisibilityChange);
  }

  function detachRecoveryListeners() {
    const track = stream?.getAudioTracks?.()?.[0];
    if (track) track.removeEventListener('ended', handleTrackEnded);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pageshow', handleVisibilityChange);
    if (recoveryTimer !== null) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
  }

  /**
   * Reintenta el mic tras una suspensión/kill del SO en background. Con el
   * permiso ya concedido, getUserMedia no vuelve a preguntar en Android ni
   * desktop; en iOS la app ya está en foreground con la sesión activa.
   * No emite 'stopped' mientras reintenta: la UI sigue mostrando "running".
   */
  async function recover() {
    if (!running || recovering) return;
    recovering = true;
    needsRecovery = false;
    releaseAudioGraph();
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      await setupAudioGraph(stream);
      attachRecoveryListeners();
    } catch (e) {
      console.warn('[tuner] mic recovery failed:', e);
      releaseAudioGraph();
      running = false;
      detachRecoveryListeners();
      onState('stopped');
    } finally {
      recovering = false;
    }
  }

  function stop() {
    running = false;
    detachRecoveryListeners();
    releaseAudioGraph();
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
