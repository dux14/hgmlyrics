/**
 * warmup.js — Genera el calentamiento de voz guiado: runs ascendentes (patrón
 * 1-2-3-2-1 sobre la escala mayor) que recorren el rango de la nota grave a la aguda.
 * Puro y síncrono.
 */
import { noteToMidi } from './notes.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Rangos por defecto por tipo de voz (fallback si el perfil no tiene rango). */
export const DEFAULT_RANGES = {
  soprano: ['C4', 'C6'],
  contralto: ['F3', 'F5'],
  tenor: ['C3', 'C5'],
  bajo: ['E2', 'E4'],
};

// Patrón melódico de cada run: tónica, 2ª mayor, 3ª mayor y vuelta.
const RUN_OFFSETS = [0, 2, 4, 2, 0];
const RUN_TOP = Math.max(...RUN_OFFSETS);

function midiToLabel(midi) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

/**
 * @param {{ rangeLow?: string, rangeHigh?: string, voiceType?: string }} [opts]
 * @returns {string[]} Secuencia plana de notas a cantar.
 */
export function buildWarmup({ rangeLow, rangeHigh, voiceType } = {}) {
  let low = rangeLow;
  let high = rangeHigh;
  if (!low || !high) {
    const fallback = DEFAULT_RANGES[voiceType] || DEFAULT_RANGES.tenor;
    [low, high] = fallback;
  }
  const lowMidi = noteToMidi(low);
  const highMidi = noteToMidi(high);
  const seq = [];
  for (let start = lowMidi; start + RUN_TOP <= highMidi; start += 1) {
    for (const off of RUN_OFFSETS) seq.push(midiToLabel(start + off));
  }
  return seq;
}
