import { describe, it, expect } from 'vitest';
import {
  detectPitch,
  detectPitchDetailed,
  analyzeBuffer,
  createWindower,
  createOverlapWindower,
} from '../src/lib/pitchCore.js';

const SAMPLE_RATE = 44100;
const SAMPLES = 2048;
function sine(freq, n = SAMPLES, amp = 0.5) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  return out;
}

/** Generador determinista de "ruido blanco" (mulberry32) — sin depender de Math.random. */
function noise(n = SAMPLES, amp = 0.5, seed = 1) {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    out[i] = amp * (r * 2 - 1);
  }
  return out;
}

describe('pitchCore.detectPitch', () => {
  it('detecta A4 (440Hz) con < 5 cents de error', () => {
    const hz = detectPitch(sine(440), SAMPLE_RATE);
    expect(hz).not.toBeNull();
    expect(Math.abs(1200 * Math.log2(hz / 440))).toBeLessThan(5);
  });
  it('rechaza el silencio', () => {
    expect(detectPitch(new Float32Array(SAMPLES), SAMPLE_RATE)).toBeNull();
  });
});

describe('analyzeBuffer', () => {
  it('devuelve { hz, rms, confidence } para un seno A4', () => {
    const { hz, rms, confidence } = analyzeBuffer(sine(440), SAMPLE_RATE);
    expect(Math.abs(1200 * Math.log2(hz / 440))).toBeLessThan(5);
    expect(rms).toBeGreaterThan(0.3); // amp 0.5 → rms ≈ 0.354
    expect(confidence).toBeGreaterThan(0.8);
  });
  it('hz null pero rms reportado en silencio, confidence 0', () => {
    const { hz, rms, confidence } = analyzeBuffer(new Float32Array(SAMPLES), SAMPLE_RATE);
    expect(hz).toBeNull();
    expect(rms).toBe(0);
    expect(confidence).toBe(0);
  });
});

describe('pitchCore.detectPitchDetailed (pYIN-lite)', () => {
  it('detecta A4 (440Hz) con <5 cents de error y confianza alta', () => {
    const result = detectPitchDetailed(sine(440), SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(Math.abs(1200 * Math.log2(result.hz / 440))).toBeLessThan(5);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('no comete octave error con un 2º armónico dominante (F0=220Hz)', () => {
    const n = SAMPLES;
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      buf[i] =
        0.3 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) +
        0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }
    const result = detectPitchDetailed(buf, SAMPLE_RATE);
    expect(result).not.toBeNull();
    // debe reportar la F0 real (220), no un salto a 110 (octava abajo) ni 880 (octava arriba)
    expect(Math.abs(1200 * Math.log2(result.hz / 220))).toBeLessThan(20);
  });

  it('ruido blanco determinista devuelve null', () => {
    const result = detectPitchDetailed(noise(SAMPLES, 0.5, 7), SAMPLE_RATE);
    expect(result).toBeNull();
  });

  it('seno 440 + ruido: sigue detectando 440 con confianza menor que el seno limpio', () => {
    const clean = detectPitchDetailed(sine(440, SAMPLES, 0.4), SAMPLE_RATE);
    const n = SAMPLES;
    const noisy = new Float32Array(n);
    const noiseComponent = noise(n, 0.15, 3);
    for (let i = 0; i < n; i++) {
      noisy[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) + noiseComponent[i];
    }
    const result = detectPitchDetailed(noisy, SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(Math.abs(1200 * Math.log2(result.hz / 440))).toBeLessThan(15);
    expect(result.confidence).toBeLessThan(clean.confidence);
  });
});

describe('createWindower', () => {
  it('devuelve null hasta completar fftSize y luego una ventana llena', () => {
    const w = createWindower(256);
    const frame = new Float32Array(128).fill(0.2);
    expect(w.push(frame)).toBeNull(); // 128/256
    const out = w.push(frame); // 256/256 → ventana
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(256);
    expect(out[0]).toBeCloseTo(0.2, 6);
  });
  it('reinicia el llenado tras emitir una ventana', () => {
    const w = createWindower(256);
    const frame = new Float32Array(128).fill(0.1);
    w.push(frame);
    w.push(frame); // emite
    expect(w.push(frame)).toBeNull(); // vuelve a acumular desde 0
  });
  it('reset() limpia el acumulador', () => {
    const w = createWindower(256);
    w.push(new Float32Array(128).fill(0.5));
    w.reset();
    expect(w.push(new Float32Array(128).fill(0.5))).toBeNull();
  });
});

describe('createOverlapWindower', () => {
  /** Empuja `n` muestras en frames de 128 (tamaño real del worklet) y devuelve la última ventana. */
  function pushRamp(w, n, start = 0) {
    let out = null;
    let value = start;
    for (let pushed = 0; pushed < n; pushed += 128) {
      const frame = new Float32Array(128);
      for (let i = 0; i < 128; i++) frame[i] = value++;
      const w2 = w.push(frame);
      if (w2) out = w2;
    }
    return out;
  }

  it('la primera ventana llega al completar fftSize muestras', () => {
    const w = createOverlapWindower(512, 128);
    expect(pushRamp(w, 384)).toBeNull(); // 384/512: aún no llena
    const first = pushRamp(w, 128); // 512/512
    expect(first).toBeInstanceOf(Float32Array);
    expect(first.length).toBe(512);
  });

  it('las siguientes ventanas llegan cada hop, con las últimas fftSize muestras en orden', () => {
    const w = createOverlapWindower(512, 128);
    pushRamp(w, 512, 0); // llena la primera ventana (muestras 0..511)
    const w2 = pushRamp(w, 128, 512); // 128 muestras nuevas (512..639) → ventana 128..639
    expect(w2).not.toBeNull();
    // monotónico creciente (rampa) y el último elemento es la última muestra pusheada (639).
    for (let i = 1; i < w2.length; i++) expect(w2[i]).toBeGreaterThan(w2[i - 1]);
    expect(w2[w2.length - 1]).toBe(639);
    expect(w2[0]).toBe(128);
  });

  it('reset() vuelve al estado inicial (la siguiente ventana necesita fftSize de nuevo)', () => {
    const w = createOverlapWindower(512, 128);
    pushRamp(w, 512);
    w.reset();
    expect(pushRamp(w, 384)).toBeNull();
    expect(pushRamp(w, 128)).toBeInstanceOf(Float32Array);
  });

  it('un seno de 440Hz pusheado en frames de 128 produce ventanas donde detectPitch detecta ~440', () => {
    const w = createOverlapWindower(2048, 512);
    const totalSamples = 2048 + 512 * 3;
    let detected = null;
    for (let pushed = 0; pushed < totalSamples; pushed += 128) {
      const frame = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        const t = pushed + i;
        frame[i] = 0.5 * Math.sin((2 * Math.PI * 440 * t) / SAMPLE_RATE);
      }
      const window = w.push(frame);
      if (window) detected = detectPitch(window, SAMPLE_RATE);
    }
    expect(detected).not.toBeNull();
    expect(Math.abs(1200 * Math.log2(detected / 440))).toBeLessThan(5);
  });

  it('la ventana devuelta es el mismo objeto reutilizado entre emisiones', () => {
    const w = createOverlapWindower(512, 128);
    const w1 = pushRamp(w, 512);
    const w2 = pushRamp(w, 128);
    expect(w1).not.toBeNull();
    expect(w2).not.toBeNull();
    expect(w1).toBe(w2);
  });
});
