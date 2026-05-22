import { describe, it, expect } from 'vitest';
import {
  noteToFrequency,
  noteToMidi,
  frequencyToNote,
  getScaleNotes,
  nearestString,
  GUITAR_STANDARD,
} from '../src/lib/notes.js';

describe('noteToMidi', () => {
  it('handles reference points', () => {
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C4')).toBe(60); // middle C
    expect(noteToMidi('A0')).toBe(21);
    expect(noteToMidi('C-1')).toBe(0);
  });

  it('handles sharps and flats interchangeably', () => {
    expect(noteToMidi('F#4')).toBe(66);
    expect(noteToMidi('Gb4')).toBe(66);
    expect(noteToMidi('A#3')).toBe(58);
    expect(noteToMidi('Bb3')).toBe(58);
  });

  it('throws on invalid', () => {
    expect(() => noteToMidi('H4')).toThrow();
    expect(() => noteToMidi('A')).toThrow();
    expect(() => noteToMidi('')).toThrow();
  });
});

describe('noteToFrequency', () => {
  it('matches the equal-temperament reference points', () => {
    expect(noteToFrequency('A4')).toBeCloseTo(440, 2);
    expect(noteToFrequency('A5')).toBeCloseTo(880, 2);
    expect(noteToFrequency('A3')).toBeCloseTo(220, 2);
    expect(noteToFrequency('C4')).toBeCloseTo(261.626, 1);
    expect(noteToFrequency('E2')).toBeCloseTo(82.407, 1); // low E guitar
  });
});

describe('frequencyToNote', () => {
  it('inverts noteToFrequency exactly at named notes', () => {
    for (const n of ['A4', 'C4', 'F#3', 'E2', 'B5', 'A#3']) {
      const hz = noteToFrequency(n);
      const r = frequencyToNote(hz);
      expect(`${r.note}${r.octave}`).toBe(n.replace('Bb', 'A#').replace('Gb', 'F#'));
      expect(Math.abs(r.cents)).toBeLessThanOrEqual(0);
    }
  });

  it('reports cents deviation for off-pitch input', () => {
    // +20 cents from A4: 440 * 2^(0.20/12)
    const hz = 440 * Math.pow(2, 0.2 / 12);
    const r = frequencyToNote(hz);
    expect(r.note).toBe('A');
    expect(r.octave).toBe(4);
    expect(r.cents).toBe(20);
  });

  it('returns null on invalid input', () => {
    expect(frequencyToNote(0)).toBeNull();
    expect(frequencyToNote(-100)).toBeNull();
    expect(frequencyToNote(NaN)).toBeNull();
    expect(frequencyToNote(Infinity)).toBeNull();
  });
});

describe('getScaleNotes', () => {
  it('returns 7 notes of C major', () => {
    expect(getScaleNotes('C major')).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });

  it('returns 7 notes of A minor (relative minor of C)', () => {
    expect(getScaleNotes('A minor')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('returns 7 notes of G major', () => {
    expect(getScaleNotes('G major')).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F#']);
  });

  it('returns 7 notes of E minor (relative minor of G)', () => {
    expect(getScaleNotes('E minor')).toEqual(['E', 'F#', 'G', 'A', 'B', 'C', 'D']);
  });

  it('throws on unknown key', () => {
    expect(() => getScaleNotes('Bb major')).toThrow(); // not canonical
    expect(() => getScaleNotes('A')).toThrow();
  });
});

describe('nearestString', () => {
  it('matches every standard string within 1 cent at exact freq', () => {
    for (const s of GUITAR_STANDARD) {
      const hz = noteToFrequency(s);
      const r = nearestString(hz);
      expect(r.string).toBe(s);
      expect(Math.abs(r.cents)).toBeLessThanOrEqual(1);
    }
  });

  it('reports deviation when slightly off', () => {
    // A2 is 110 Hz, +25 cents
    const hz = 110 * Math.pow(2, 0.25 / 12);
    const r = nearestString(hz);
    expect(r.string).toBe('A2');
    expect(r.cents).toBeGreaterThan(20);
    expect(r.cents).toBeLessThan(30);
  });

  it('chooses E2 for very low pitches near 82Hz', () => {
    expect(nearestString(82.4).string).toBe('E2');
  });

  it('returns null on invalid input', () => {
    expect(nearestString(0)).toBeNull();
    expect(nearestString(-5)).toBeNull();
  });
});
