import { describe, it, expect } from 'vitest';
import { createExercise } from '../src/lib/exerciseEngine.js';

const tuned = (note, octave) => ({ note, octave, cents: 2, hz: 440, midi: 69, held: false });

describe('createExercise', () => {
  it('current() canoniza el primer objetivo', () => {
    const ex = createExercise({ sequence: ['A4', 'C5'], holdFrames: 3 });
    expect(ex.current()).toEqual({ note: 'A', octave: 4, label: 'A4' });
  });

  it('avanza tras holdFrames frames afinados consecutivos', () => {
    const ex = createExercise({ sequence: ['A4', 'C5'], holdFrames: 3 });
    expect(ex.push(tuned('A', 4)).holdCount).toBe(1);
    expect(ex.push(tuned('A', 4)).holdCount).toBe(2);
    const r = ex.push(tuned('A', 4));
    expect(r.justAdvanced).toBe(true);
    expect(ex.current()).toEqual({ note: 'C', octave: 5, label: 'C5' });
  });

  it('un null (silencio) resetea el holdCount', () => {
    const ex = createExercise({ sequence: ['A4'], holdFrames: 3 });
    ex.push(tuned('A', 4));
    expect(ex.push(null).holdCount).toBe(0);
  });

  it('una nota equivocada resetea el holdCount', () => {
    const ex = createExercise({ sequence: ['A4'], holdFrames: 3 });
    ex.push(tuned('A', 4));
    expect(ex.push(tuned('B', 4)).holdCount).toBe(0);
  });

  it('skip() cuenta como fallo y avanza', () => {
    const ex = createExercise({ sequence: ['A4', 'C5'], holdFrames: 3 });
    ex.skip();
    expect(ex.current()).toEqual({ note: 'C', octave: 5, label: 'C5' });
    expect(ex.summary()).toMatchObject({ total: 2, hits: 0, misses: 1 });
  });

  it('summary() final cuenta aciertos y done', () => {
    const ex = createExercise({ sequence: ['A4'], holdFrames: 1 });
    const r = ex.push(tuned('A', 4));
    expect(r.done).toBe(true);
    expect(ex.summary()).toMatchObject({ total: 1, hits: 1, misses: 0 });
  });

  it('reset() vuelve al inicio', () => {
    const ex = createExercise({ sequence: ['A4'], holdFrames: 1 });
    ex.push(tuned('A', 4));
    ex.reset();
    expect(ex.current()).toEqual({ note: 'A', octave: 4, label: 'A4' });
    expect(ex.summary()).toMatchObject({ hits: 0, misses: 0 });
  });
});
