/**
 * metronomeClick.js — click de metrónomo por lookahead (~25ms tick, ventana
 * 120ms) anclado a getTimeMs() (audio.currentTime*1000 del caller). El
 * AudioContext se crea LAZY en el primer unmute (gesto de usuario, iOS).
 * Acento (beatInBar 1): 1320 Hz; resto: 880 Hz; blips de 0.03s con envelope.
 * @param {{ clock: ReturnType<typeof import('./beatClock.js').createBeatClock>, getTimeMs: () => number, createContext?: () => AudioContext }} opts
 * @returns {{ setMuted(m: boolean): void, isMuted(): boolean, stop(): void }}
 */

const TICK_MS = 25;
const LOOKAHEAD_MS = 120;
const BLIP_SEC = 0.03;
const ACCENT_HZ = 1320;
const BEAT_HZ = 880;

export function createMetronomeClick({ clock, getTimeMs, createContext }) {
  let muted = true;
  let ctx = null;
  let intervalId = null;
  // Último ms de beat ya agendado; -Infinity hasta el primer unmute.
  let lastScheduled = -Infinity;

  function makeContext() {
    if (ctx) return ctx;
    ctx = createContext ? createContext() : new AudioContext();
    return ctx;
  }

  /** Agenda un blip en beatMs (ms del reloj del caller), con acento si beatInBar === 1. */
  function scheduleBeat(beatMs, beatInBar, nowMs) {
    const c = makeContext();
    const startAt = c.currentTime + Math.max(0, beatMs - nowMs) / 1000;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = beatInBar === 1 ? ACCENT_HZ : BEAT_HZ;
    osc.connect(gain);
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(1, startAt + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + BLIP_SEC);
    osc.start(startAt);
    osc.stop(startAt + BLIP_SEC);
  }

  /** Recorre la rejilla desde `now` hasta `now + LOOKAHEAD_MS` agendando beats nuevos. */
  function tick() {
    const nowMs = getTimeMs();
    let t = Math.max(nowMs, lastScheduled);
    for (;;) {
      const { msToNextBeat } = clock.at(t);
      if (msToNextBeat === null) break;
      const beatMs = t + msToNextBeat;
      if (beatMs > nowMs + LOOKAHEAD_MS) break;
      if (beatMs > lastScheduled) {
        scheduleBeat(beatMs, clock.at(beatMs).beatInBar, nowMs);
        lastScheduled = beatMs;
      }
      t = beatMs;
    }
  }

  function startInterval() {
    if (intervalId !== null) return;
    intervalId = setInterval(tick, TICK_MS);
  }

  function stopInterval() {
    if (intervalId === null) return;
    clearInterval(intervalId);
    intervalId = null;
  }

  function setMuted(m) {
    muted = !!m;
    if (muted) {
      stopInterval();
    } else {
      makeContext();
      startInterval();
    }
  }

  function isMuted() {
    return muted;
  }

  function stop() {
    stopInterval();
    if (ctx) {
      ctx.close();
      ctx = null;
    }
  }

  return { setMuted, isMuted, stop };
}
