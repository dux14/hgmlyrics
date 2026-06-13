// src/lib/metronome.js
/**
 * metronome.js — Motor de metrónomo puro (sin DOM, testeable).
 * Timing por lookahead scheduler (patrón Chris Wilson "A Tale of Two Clocks"):
 * se agenda contra `audioContext.currentTime`, no contra setTimeout. El tick del
 * scheduler corre en un Web Worker para no derivar en pestaña inactiva (PWA/móvil),
 * con fallback a setInterval. El click se sintetiza con OscillatorNode (acento vs normal).
 * AudioContextClass / WorkerClass / now son inyectables para tests.
 */

export const TIME_SIGNATURES = {
  '4/4': { beats: 4, accents: [0] },
  '3/4': { beats: 3, accents: [0] },
  '2/4': { beats: 2, accents: [0] },
  '6/8': { beats: 6, accents: [0, 3] },
};

export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const DEFAULT_BPM = 120;
export const DEFAULT_SIGNATURE = '4/4';

export function clampBpm(bpm) {
  const n = Math.round(Number(bpm));
  if (!Number.isFinite(n)) return DEFAULT_BPM;
  return Math.max(BPM_MIN, Math.min(BPM_MAX, n));
}

/**
 * Mediana de intervalos (ms) con rechazo de outliers: se descartan los que
 * se desvían más del 50% respecto a la mediana, y se promedia el resto.
 * Devuelve un BPM ya recortado a rango, o null si no hay datos válidos.
 */
export function tapBpmFromIntervals(intervals) {
  if (!intervals || intervals.length === 0) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const kept = intervals.filter((iv) => Math.abs(iv - median) <= median * 0.5);
  const use = kept.length ? kept : intervals;
  const avg = use.reduce((a, b) => a + b, 0) / use.length;
  if (!(avg > 0)) return null;
  return clampBpm(60000 / avg);
}

// Worker inline: emite 'tick' cada `interval` ms. Evita el throttling de timers
// en pestaña inactiva (PWA/móvil) que sí sufre setInterval en el main thread.
const WORKER_SRC = `
  let id = null;
  onmessage = (e) => {
    const d = e.data || {};
    if (d.cmd === 'start') {
      if (id !== null) clearInterval(id);
      id = setInterval(() => postMessage('tick'), d.interval || 25);
    } else if (d.cmd === 'stop') {
      if (id !== null) { clearInterval(id); id = null; }
    }
  };
`;

const TAP_RESET_GAP_MS = 2000;
const TAP_MAX_SAMPLES = 8; // hasta 8 timestamps → 7 intervalos

export function createMetronome(opts = {}) {
  const {
    AudioContextClass,
    WorkerClass,
    now,
    onBeat,
    useWorker = true,
    lookahead = 25, // ms entre ticks del scheduler
    scheduleAheadTime = 0.1, // s de ventana de agendado
  } = opts;

  const AudioCtor = AudioContextClass || globalThis.AudioContext || globalThis.webkitAudioContext;
  const WorkerCtor = WorkerClass || globalThis.Worker;
  const clock = now || (() => (globalThis.performance ? performance.now() : Date.now()));

  let ctx = null;
  let bpm = DEFAULT_BPM;
  let signatureId = DEFAULT_SIGNATURE;
  let running = false;
  let currentBeat = 0; // próximo beat a agendar (mod beats)
  let nextNoteTime = 0; // tiempo de audio del próximo beat
  let worker = null;
  let intervalId = null;
  let tapTimes = [];

  function ensureCtx() {
    if (!ctx) {
      try {
        ctx = new AudioCtor();
      } catch (_e) {
        ctx = AudioCtor();
      }
    }
    return ctx;
  }

  function beatsPerBar() {
    return TIME_SIGNATURES[signatureId].beats;
  }
  function isAccent(beat) {
    return TIME_SIGNATURES[signatureId].accents.includes(beat);
  }

  function setBpm(next) {
    bpm = clampBpm(next);
    return bpm;
  }
  function getBpm() {
    return bpm;
  }

  function setSignature(id) {
    if (TIME_SIGNATURES[id]) {
      signatureId = id;
      if (currentBeat >= beatsPerBar()) currentBeat = 0;
    }
    return signatureId;
  }
  function getSignature() {
    return signatureId;
  }

  function tap() {
    const t = clock();
    const last = tapTimes.length ? tapTimes[tapTimes.length - 1] : null;
    if (last !== null && t - last > TAP_RESET_GAP_MS) tapTimes = [];
    tapTimes.push(t);
    if (tapTimes.length > TAP_MAX_SAMPLES) tapTimes = tapTimes.slice(-TAP_MAX_SAMPLES);
    if (tapTimes.length < 2) return null;
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) {
      intervals.push(tapTimes[i] - tapTimes[i - 1]);
    }
    const estimate = tapBpmFromIntervals(intervals);
    if (estimate !== null) setBpm(estimate);
    return estimate;
  }
  function resetTap() {
    tapTimes = [];
  }

  function scheduleClick(beat, time) {
    const c = ctx;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.frequency.value = isAccent(beat) ? 1500 : 800;
    const dur = 0.03;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.6, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(time);
    osc.stop(time + dur);
    if (typeof onBeat === 'function') onBeat(beat, isAccent(beat), time);
  }

  function advanceNote() {
    nextNoteTime += 60.0 / bpm;
    currentBeat = (currentBeat + 1) % beatsPerBar();
  }

  function scheduler() {
    if (!running || !ctx) return;
    while (nextNoteTime < ctx.currentTime + scheduleAheadTime) {
      scheduleClick(currentBeat, nextNoteTime);
      advanceNote();
    }
  }

  function startTicker() {
    if (useWorker && WorkerCtor) {
      try {
        const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        worker = new WorkerCtor(url);
        worker.onmessage = () => scheduler();
        worker.postMessage({ cmd: 'start', interval: lookahead });
        return;
      } catch (_e) {
        worker = null; // fallback a setInterval
      }
    }
    intervalId = setInterval(scheduler, lookahead);
  }

  function stopTicker() {
    if (worker) {
      try {
        worker.postMessage({ cmd: 'stop' });
        worker.terminate();
      } catch (_e) {
        /* noop */
      }
      worker = null;
    }
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function start() {
    if (running) return;
    const c = ensureCtx();
    if (c.state === 'suspended' && c.resume) c.resume();
    running = true;
    currentBeat = 0;
    nextNoteTime = c.currentTime;
    startTicker();
    scheduler(); // primer beat inmediato
  }

  function stop() {
    if (!running) return;
    running = false;
    stopTicker();
  }

  function audioTime() {
    return ctx ? ctx.currentTime : 0;
  }
  function isRunning() {
    return running;
  }
  function getCurrentBeat() {
    return currentBeat;
  }

  function dispose() {
    stop();
    stopTicker();
    tapTimes = [];
    if (ctx && ctx.close) {
      try {
        ctx.close();
      } catch (_e) {
        /* noop */
      }
      ctx = null;
    }
  }

  return {
    start,
    stop,
    isRunning,
    setBpm,
    getBpm,
    setSignature,
    getSignature,
    tap,
    resetTap,
    audioTime,
    getCurrentBeat,
    dispose,
  };
}
