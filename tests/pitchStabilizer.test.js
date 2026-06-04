import { describe, it, expect } from 'vitest';
import { createPitchStabilizer } from '../src/lib/pitchStabilizer.js';
import { noteToFrequency } from '../src/lib/notes.js';

/** Helper: stabilizer con reloj falso que avanza 33ms por push. */
function makeStab(opts = {}) {
  let t = 0;
  const stab = createPitchStabilizer({ now: () => t, ...opts });
  return {
    push(hz) {
      t += 33;
      return stab.push({ hz, rms: 0.1 });
    },
    reset: stab.reset,
    clock: { advance: (ms) => (t += ms) },
  };
}

describe('pitchStabilizer — hold ante nulls (flicker)', () => {
  it('un null de 1 frame NO borra la lectura: devuelve held', () => {
    const s = makeStab();
    for (let i = 0; i < 6; i++) s.push(220); // A3 estable
    const out = s.push(null);
    expect(out).not.toBeNull();
    expect(out.held).toBe(true);
    expect(out.note).toBe('A');
    expect(out.octave).toBe(3);
  });
  it('nulls sostenidos más allá de holdMs sí devuelven null', () => {
    const s = makeStab({ holdMs: 250 });
    for (let i = 0; i < 6; i++) s.push(220);
    s.clock.advance(300);
    expect(s.push(null)).toBeNull();
  });
});

describe('pitchStabilizer — mediana contra saltos de octava', () => {
  it('un frame a la octava (440 entre 220s) no cambia la nota', () => {
    const s = makeStab();
    for (let i = 0; i < 5; i++) s.push(220);
    const out = s.push(440); // outlier de 1 frame
    expect(out.note).toBe('A');
    expect(out.octave).toBe(3); // mediana sigue en 220
  });
});

describe('pitchStabilizer — histéresis de nota', () => {
  it('la nota mostrada NO aletea en la frontera entre dos notas', () => {
    const s = makeStab({ noteStableFrames: 3, medianWindow: 1, emaAlpha: 1 });
    const a3 = noteToFrequency('A3');
    const as3 = noteToFrequency('A#3');
    for (let i = 0; i < 5; i++) s.push(a3);
    expect(s.push(as3).note).toBe('A');
    expect(s.push(as3).note).toBe('A');
    expect(s.push(as3).note).toBe('A#');
  });
});

describe('pitchStabilizer — EMA de cents', () => {
  it('suaviza el vibrato: la variación de cents emitida es menor que la cruda', () => {
    const s = makeStab({ medianWindow: 1, emaAlpha: 0.3 });
    const base = noteToFrequency('A3');
    const emitted = [];
    for (let i = 0; i < 40; i++) {
      const cents = 30 * Math.sin(i / 3);
      const hz = base * Math.pow(2, cents / 1200);
      const out = s.push(hz);
      if (out) emitted.push(out.cents);
    }
    const maxEmitted = Math.max(...emitted.map(Math.abs));
    expect(maxEmitted).toBeLessThan(30);
  });
});

describe('pitchStabilizer — reset', () => {
  it('reset limpia el estado (no retiene nota previa)', () => {
    const s = makeStab();
    for (let i = 0; i < 6; i++) s.push(220);
    s.reset();
    expect(s.push(null)).toBeNull();
  });
});

describe('pitchStabilizer — guardas de entrada', () => {
  it('hz 0, negativo, NaN e Infinity se tratan como null', () => {
    const s = makeStab();
    for (let i = 0; i < 6; i++) s.push(220);
    for (const bad of [0, -100, NaN, Infinity]) {
      const out = s.push(bad);
      expect(out === null || out.held === true).toBe(true);
    }
  });
  it('los frames held NO extienden la ventana de hold', () => {
    const s = makeStab({ holdMs: 250 });
    for (let i = 0; i < 6; i++) s.push(220);
    // 7 nulls a 33ms: los primeros ~7 frames (231ms) van held, luego null
    const outs = [];
    for (let i = 0; i < 9; i++) outs.push(s.push(null));
    expect(outs[0]).not.toBeNull();
    expect(outs[0].held).toBe(true);
    expect(outs[8]).toBeNull(); // 9*33=297ms > 250ms: expiró pese a los held intermedios
  });
});
