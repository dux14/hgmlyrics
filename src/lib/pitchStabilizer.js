/**
 * pitchStabilizer.js — Capa de estabilización temporal entre el detector YIN
 * (pitch.js) y la UI del afinador (Tuner.js).
 *
 * Cuatro etapas contra las oscilaciones:
 *   1. Mediana móvil sobre hz       → rechaza saltos de octava de 1 frame.
 *   2. Hold ante nulls (~250ms)     → mata el flicker «—»/nota.
 *   3. Histéresis de nota           → la etiqueta cambia solo tras N frames estables.
 *   4. EMA de cents                 → la aguja fluye en vez de saltar.
 *
 * `confidence` (opcional, 0..1) del detector afina las etapas 2 y 3: un frame
 * de baja confianza se trata como si no hubiera pitch (hold), y un cambio de
 * nota exige más frames estables cuando la confianza media es baja. Si no se
 * envía `confidence` (undefined) el comportamiento es EXACTAMENTE el de antes.
 *
 * Puro y sin DOM: `now` es inyectable para tests deterministas.
 */

import { frequencyToNote } from './notes.js';

const DEFAULT_MEDIAN_WINDOW = 5;
const DEFAULT_HOLD_MS = 250;
const DEFAULT_NOTE_STABLE_FRAMES = 3;
const DEFAULT_EMA_ALPHA = 0.3;
const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_STRONG_CONFIDENCE = 0.75;

/**
 * @param {{ medianWindow?: number, holdMs?: number, noteStableFrames?: number,
 *           emaAlpha?: number, minConfidence?: number, strongConfidence?: number,
 *           now?: () => number }} [opts]
 *   `minConfidence`: por debajo de este umbral, un frame se trata como si hz
 *   fuera null (no alimenta mediana ni histéresis). Default 0.5.
 *   `strongConfidence`: si la confianza media de los frames candidatos a un
 *   cambio de nota es ≥ este umbral, el cambio se confirma tras
 *   `noteStableFrames`; si no, exige `noteStableFrames + 2`. Default 0.75.
 * @returns {{ push: (s: {hz: number|null, rms?: number, confidence?: number}) =>
 *             ({hz:number, note:string, octave:number, cents:number, midi:number, held:boolean} | null),
 *             reset: () => void }}
 */
export function createPitchStabilizer(opts = {}) {
  const medianWindow = opts.medianWindow ?? DEFAULT_MEDIAN_WINDOW;
  const holdMs = opts.holdMs ?? DEFAULT_HOLD_MS;
  const noteStableFrames = opts.noteStableFrames ?? DEFAULT_NOTE_STABLE_FRAMES;
  const emaAlpha = opts.emaAlpha ?? DEFAULT_EMA_ALPHA;
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const strongConfidence = opts.strongConfidence ?? DEFAULT_STRONG_CONFIDENCE;
  const now = opts.now ?? (() => performance.now());

  let hzBuf = [];
  let lastOutput = null;
  let lastPitchAt = -Infinity;
  let displayedMidi = null;
  let candidateMidi = null;
  let candidateCount = 0;
  let candidateConfSum = 0;
  let candidateConfCount = 0;
  let emaCents = null;

  function reset() {
    hzBuf = [];
    lastOutput = null;
    lastPitchAt = -Infinity;
    displayedMidi = null;
    candidateMidi = null;
    candidateCount = 0;
    candidateConfSum = 0;
    candidateConfCount = 0;
    emaCents = null;
  }

  function push(sample) {
    const t = now();
    const hz = sample?.hz ?? null;
    const confidence = sample?.confidence;
    const lowConfidence = typeof confidence === 'number' && confidence < minConfidence;

    // 2. Hold: null breve (o baja confianza) retiene la última lectura estable.
    if (hz === null || !Number.isFinite(hz) || hz <= 0 || lowConfidence) {
      if (lastOutput && t - lastPitchAt <= holdMs) return { ...lastOutput, held: true };
      return null;
    }
    lastPitchAt = t;

    // 1. Mediana móvil.
    hzBuf.push(hz);
    if (hzBuf.length > medianWindow) hzBuf.shift();
    const sorted = [...hzBuf].sort((a, b) => a - b);
    const medianHz = sorted[Math.floor(sorted.length / 2)];

    const det = frequencyToNote(medianHz);
    if (!det) return lastOutput ? { ...lastOutput, held: true } : null;

    // 3. Histéresis de nota (por midi), adaptativa según confianza.
    if (displayedMidi === null) {
      displayedMidi = det.midi;
      candidateMidi = det.midi;
      candidateCount = 0;
      candidateConfSum = 0;
      candidateConfCount = 0;
    } else if (det.midi !== displayedMidi) {
      if (det.midi === candidateMidi) candidateCount++;
      else {
        candidateMidi = det.midi;
        candidateCount = 1;
        candidateConfSum = 0;
        candidateConfCount = 0;
      }
      if (typeof confidence === 'number') {
        candidateConfSum += confidence;
        candidateConfCount++;
      }
      // Sin dato de confianza en ningún frame del candidato: umbral clásico.
      // Con confianza media alta el cambio se confirma más rápido; con
      // confianza media baja (pero ≥ minConfidence) se exige más evidencia.
      const requiredFrames =
        candidateConfCount === 0
          ? noteStableFrames
          : candidateConfSum / candidateConfCount >= strongConfidence
            ? noteStableFrames
            : noteStableFrames + 2;
      if (candidateCount >= requiredFrames) {
        displayedMidi = candidateMidi;
        candidateCount = 0;
        candidateConfSum = 0;
        candidateConfCount = 0;
        emaCents = null; // nueva nota: el EMA arranca limpio
      }
    } else {
      candidateMidi = det.midi;
      candidateCount = 0;
      candidateConfSum = 0;
      candidateConfCount = 0;
    }

    // 4. Cents relativos a la nota MOSTRADA (continuos durante la histéresis) + EMA.
    const displayedFreq = 440 * Math.pow(2, (displayedMidi - 69) / 12);
    const rawCents = 1200 * Math.log2(medianHz / displayedFreq);
    emaCents = emaCents === null ? rawCents : emaAlpha * rawCents + (1 - emaAlpha) * emaCents;

    const disp = frequencyToNote(displayedFreq);
    lastOutput = {
      hz: medianHz,
      note: disp.note,
      octave: disp.octave,
      cents: Math.round(emaCents),
      midi: displayedMidi,
      held: false,
    };
    return lastOutput;
  }

  return { push, reset };
}
