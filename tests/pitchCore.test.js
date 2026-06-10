import { describe, it, expect } from 'vitest';
import { detectPitch, analyzeBuffer } from '../src/lib/pitchCore.js';

const SAMPLE_RATE = 44100;
const SAMPLES = 2048;
function sine(freq, n = SAMPLES, amp = 0.5) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
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
  it('devuelve { hz, rms } para un seno A4', () => {
    const { hz, rms } = analyzeBuffer(sine(440), SAMPLE_RATE);
    expect(Math.abs(1200 * Math.log2(hz / 440))).toBeLessThan(5);
    expect(rms).toBeGreaterThan(0.3); // amp 0.5 → rms ≈ 0.354
  });
  it('hz null pero rms reportado en silencio', () => {
    const { hz, rms } = analyzeBuffer(new Float32Array(SAMPLES), SAMPLE_RATE);
    expect(hz).toBeNull();
    expect(rms).toBe(0);
  });
});
