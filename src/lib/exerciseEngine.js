/**
 * exerciseEngine.js — Motor de progreso para el modo Entrenar.
 * Recibe la salida ya estabilizada del afinador (pitchStabilizer) y avanza
 * por la secuencia cuando el usuario sostiene la nota afinada N frames.
 * Puro: no toca DOM ni audio.
 */
import { noteToFrequency, frequencyToNote, matchesTarget } from './notes.js';

/**
 * @param {{ sequence: string[], holdFrames?: number }} opts
 */
export function createExercise({ sequence, holdFrames = 8 } = {}) {
  // Canoniza cada etiqueta para que coincida con la salida de frequencyToNote.
  const targets = (sequence || []).map((label) => {
    const canon = frequencyToNote(noteToFrequency(label));
    return { note: canon.note, octave: canon.octave, label: `${canon.note}${canon.octave}` };
  });
  let index = 0;
  let holdCount = 0;
  const results = [];

  function current() {
    return index < targets.length ? targets[index] : null;
  }

  function advance(hit) {
    results.push({ target: targets[index], hit });
    index += 1;
    holdCount = 0;
  }

  function push(stab) {
    const target = current();
    let justAdvanced = false;
    if (target !== null) {
      if (stab && matchesTarget(stab, target)) {
        holdCount += 1;
        if (holdCount >= holdFrames) {
          advance(true);
          justAdvanced = true;
        }
      } else {
        holdCount = 0; // silencio o nota equivocada
      }
    }
    return {
      index: Math.min(index, targets.length),
      total: targets.length,
      target: current(),
      holdCount,
      justAdvanced,
      done: current() === null,
    };
  }

  function skip() {
    if (current() !== null) advance(false);
    return { index, total: targets.length, target: current(), done: current() === null };
  }

  function summary() {
    const hits = results.filter((r) => r.hit).length;
    return { total: targets.length, hits, misses: results.length - hits, results };
  }

  function reset() {
    index = 0;
    holdCount = 0;
    results.length = 0;
  }

  return { current, push, skip, summary, reset };
}
