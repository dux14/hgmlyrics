// src/lib/tonePlayer.js
/**
 * tonePlayer.js — Reproduce un tono de referencia anclado a A4=440 (el "mundo real").
 * Oscilador `sine` con envolvente attack/release (~20ms) para evitar clicks.
 * El AudioContext se crea perezosamente (requiere gesto de usuario en iOS).
 * `AudioContextClass` es inyectable para tests.
 */
export function createTonePlayer({ AudioContextClass } = {}) {
  const Ctor = AudioContextClass || globalThis.AudioContext || globalThis.webkitAudioContext;
  let ctx = null;
  let osc = null;
  let gain = null;

  function ensureCtx() {
    // Llamamos con new si es un constructor real; el mock de tests es vi.fn(() => ctx)
    // que no es constructable, así que usamos Reflect.construct con fallback a llamada directa.
    if (!ctx) {
      try {
        ctx = new Ctor();
      } catch (_e) {
        ctx = Ctor();
      }
    }
    return ctx;
  }

  function stop() {
    if (osc) {
      try {
        osc.stop();
      } catch (_e) {
        /* ya detenido */
      }
      osc.disconnect();
      osc = null;
    }
    if (gain) {
      gain.disconnect();
      gain = null;
    }
  }

  function play(hz, durationMs = 800) {
    const c = ensureCtx();
    if (c.state === 'suspended' && c.resume) c.resume();
    stop();
    const now = c.currentTime;
    const end = now + durationMs / 1000;
    osc = c.createOscillator();
    gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gain.gain.setValueAtTime(0.2, Math.max(now + 0.02, end - 0.02));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(end);
  }

  function close() {
    stop();
    if (ctx && ctx.close) {
      ctx.close();
      ctx = null;
    }
  }

  return { play, stop, close };
}
