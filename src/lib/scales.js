/**
 * scales.js — Generación de secuencias de escala para el modo Entrenar del afinador.
 * Puro y síncrono. Notación científica con sostenidos canónicos (igual que notes.js).
 */
import { noteToMidi } from './notes.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Intervalos (semitonos desde la tónica) de cada tipo de escala soportado. */
export const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

/** Los 4 ejercicios de escala ofrecidos en la UI. */
export const EXERCISE_PRESETS = [
  {
    id: 'c-major-pentatonic',
    label: 'Do Mayor · pentatónica',
    tonic: 'C',
    type: 'majorPentatonic',
  },
  { id: 'c-major', label: 'Do Mayor · natural', tonic: 'C', type: 'major' },
  {
    id: 'e-minor-pentatonic',
    label: 'Mi menor · pentatónica',
    tonic: 'E',
    type: 'minorPentatonic',
  },
  { id: 'e-minor', label: 'Mi menor · natural', tonic: 'E', type: 'minor' },
];

/** Convierte un número MIDI a etiqueta científica con sostenidos. */
function midiToLabel(midi) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/**
 * Construye una secuencia de notas científicas para una escala.
 * @param {{ tonic: string, type: keyof typeof SCALE_INTERVALS, startOctave: number,
 *           octaves?: number, direction?: 'up' | 'up-down' }} opts
 * @returns {string[]} Notas ascendiendo hasta la tónica+octavas y, si up-down, de vuelta.
 */
export function buildScaleSequence({
  tonic,
  type,
  startOctave,
  octaves = 1,
  direction = 'up-down',
}) {
  const intervals = SCALE_INTERVALS[type];
  if (!intervals) throw new Error(`Unknown scale type: ${type}`);
  const rootMidi = noteToMidi(`${tonic}${startOctave}`);
  const upMidi = [];
  for (let o = 0; o < octaves; o++) {
    for (const step of intervals) upMidi.push(rootMidi + o * 12 + step);
  }
  upMidi.push(rootMidi + octaves * 12); // tónica de cierre, una octava arriba
  const up = upMidi.map(midiToLabel);
  if (direction === 'up') return up;
  const down = up.slice(0, -1).reverse(); // baja sin repetir la nota más aguda
  return [...up, ...down];
}

/**
 * Elige la octava inicial que mejor centra la secuencia dentro del rango vocal.
 * Prefiere octavas donde la secuencia entra completa; entre ellas, la más centrada.
 * @param {{ tonic: string, type: keyof typeof SCALE_INTERVALS, rangeLow: string,
 *           rangeHigh: string, octaves?: number }} opts
 * @returns {number} Octava inicial (1..6).
 */
export function pickStartOctave({ tonic, rangeLow, rangeHigh, octaves = 1 }) {
  const lowMidi = noteToMidi(rangeLow);
  const highMidi = noteToMidi(rangeHigh);
  const center = (lowMidi + highMidi) / 2;
  const span = octaves * 12;
  let best = 4;
  let bestScore = Infinity;
  for (let oct = 1; oct <= 6; oct++) {
    const rootMidi = noteToMidi(`${tonic}${oct}`);
    const seqCenter = rootMidi + span / 2;
    const fits = rootMidi >= lowMidi && rootMidi + span <= highMidi;
    const score = Math.abs(seqCenter - center) + (fits ? 0 : 1000);
    if (score < bestScore) {
      bestScore = score;
      best = oct;
    }
  }
  return best;
}
