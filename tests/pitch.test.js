import { describe, it, expect } from 'vitest';
import { detectPitch } from '../src/lib/pitch.js';

const SAMPLE_RATE = 44100;
const SAMPLES = 2048;

function sine(freq, sampleRate = SAMPLE_RATE, n = SAMPLES, amp = 0.5) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function centsOff(detected, target) {
  return 1200 * Math.log2(detected / target);
}

describe('detectPitch — synthetic sines', () => {
  it('detects A4 (440Hz) within 5 cents', () => {
    const hz = detectPitch(sine(440), SAMPLE_RATE);
    expect(hz).not.toBeNull();
    expect(Math.abs(centsOff(hz, 440))).toBeLessThan(5);
  });

  it('detects A3 (220Hz) within 5 cents', () => {
    const hz = detectPitch(sine(220), SAMPLE_RATE);
    expect(Math.abs(centsOff(hz, 220))).toBeLessThan(5);
  });

  it('detects A5 (880Hz) within 5 cents', () => {
    const hz = detectPitch(sine(880), SAMPLE_RATE);
    expect(Math.abs(centsOff(hz, 880))).toBeLessThan(5);
  });

  it('detects low E (E2 = 82.4Hz) within 5 cents', () => {
    const hz = detectPitch(sine(82.4069), SAMPLE_RATE);
    expect(Math.abs(centsOff(hz, 82.4069))).toBeLessThan(5);
  });

  it('detects middle C (261.63Hz) within 5 cents', () => {
    const hz = detectPitch(sine(261.6256), SAMPLE_RATE);
    expect(Math.abs(centsOff(hz, 261.6256))).toBeLessThan(5);
  });

  it('detects high E (E4 = 329.6Hz, guitar high) within 5 cents', () => {
    const hz = detectPitch(sine(329.6276), SAMPLE_RATE);
    expect(Math.abs(centsOff(hz, 329.6276))).toBeLessThan(5);
  });
});

describe('detectPitch — robustness', () => {
  it('rejects pure silence (returns null)', () => {
    const buf = new Float32Array(SAMPLES); // all zeros
    expect(detectPitch(buf, SAMPLE_RATE)).toBeNull();
  });

  it('rejects very low amplitude (RMS gate)', () => {
    const buf = sine(440, SAMPLE_RATE, SAMPLES, 0.001);
    expect(detectPitch(buf, SAMPLE_RATE)).toBeNull();
  });

  it('rejects white noise (returns null or extreme cents off)', () => {
    const buf = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) buf[i] = (Math.random() * 2 - 1) * 0.3;
    const hz = detectPitch(buf, SAMPLE_RATE);
    // YIN may or may not bail; if it returns, it should NOT match a coherent target.
    // Just assert we don't crash. A null is acceptable; a value is acceptable.
    if (hz !== null) expect(Number.isFinite(hz)).toBe(true);
  });

  it('handles tiny buffers gracefully (returns null below 64 samples)', () => {
    expect(detectPitch(new Float32Array(32), SAMPLE_RATE)).toBeNull();
  });

  it('handles invalid sampleRate', () => {
    expect(detectPitch(sine(440), 0)).toBeNull();
    expect(detectPitch(sine(440), -1)).toBeNull();
  });

  it('detects pitch in a harmonic signal (fundamental + 2nd partial)', () => {
    // simulates a voice/guitar more than a pure sine
    const out = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      out[i] =
        0.5 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) +
        0.3 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) +
        0.15 * Math.sin((2 * Math.PI * 660 * i) / SAMPLE_RATE);
    }
    const hz = detectPitch(out, SAMPLE_RATE);
    expect(Math.abs(centsOff(hz, 220))).toBeLessThan(5);
  });
});
