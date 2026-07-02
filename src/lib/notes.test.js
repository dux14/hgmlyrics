import { describe, it, expect } from 'vitest';
import { midiToName } from './notes.js';

describe('midiToName', () => {
  it('mapea numeros MIDI a nombre + octava', () => {
    expect(midiToName(48)).toBe('C3');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(81)).toBe('A5');
    expect(midiToName(61)).toBe('C#4');
  });
});
