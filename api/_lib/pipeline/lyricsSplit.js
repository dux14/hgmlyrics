/**
 * lyricsSplit.js — Corte de renglones del documento de revisión: frontera de
 * sección, herencia de cortes desde la semilla del cancionero y split
 * heurístico (respiración + largo máximo de karaoke). Extraído de
 * lyricsReview.js, que queda con el documento y las acciones del editor.
 * Dominio PURO: sin sql, sin fetch, sin Date.now.
 */
import { suggestLineBreaks } from './phrasing.js';

// Umbral de largo para el gate karaoke: un renglón más largo que esto no cabe
// bien en el roll de letra sincronizada y se auto-parte.
export const KARAOKE_MAX_CHARS = 48;

// Umbral de confianza bajo el cual un renglón se marca vocalización
// automática (segmento sin palabras claras, spec 2026-07-23).
export const VOCALIZATION_CONFIDENCE_THRESHOLD = 0.4;

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/** Promedio round4 del score por palabra; null sin scores numéricos. */
export function lineConfidence(words) {
  const scores = (words ?? []).map((w) => w.score).filter((s) => typeof s === 'number');
  if (scores.length === 0) return null;
  return round4(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// Entre los índices de corte candidatos (afterWord, 0-based), elige el que
// deja el offset de carácter más cercano a la mitad del texto del renglón.
function closestToMiddle(candidateIndices, tokens, textLen) {
  const middle = textLen / 2;
  let best = candidateIndices[0];
  let bestDist = Infinity;
  for (const i of candidateIndices) {
    const offset = tokens.slice(0, i + 1).join(' ').length + 1;
    const dist = Math.abs(offset - middle);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

// Parte una línea v2 en la palabra `afterWord` (0-based, última del primer
// renglón), repartiendo las words y recalculando timing/confidence de cada
// mitad. Words desalineadas con los tokens (texto editado a mano): ambas
// mitades salen sin words (timing heredado nulo) — ausente es mejor que stale.
export function splitLineAtWord(line, afterWord) {
  const tokens = line.text.split(/\s+/).filter(Boolean);
  if (afterWord < 0 || afterWord >= tokens.length - 1) {
    throw new RangeError(`afterWord fuera de rango: ${afterWord}`);
  }
  const aligned = Array.isArray(line.words) && line.words.length === tokens.length;
  const mk = (text, words) => {
    const confidence = lineConfidence(words);
    return {
      text,
      startMs: words.length ? words[0].startMs : null,
      endMs: words.length ? words[words.length - 1].endMs : null,
      words,
      confidence,
      // Vocalización se RE-DERIVA por mitad (no se hereda del padre): tras el
      // corte cada renglón tiene su propio confidence y puede cruzar el
      // umbral en distinto sentido que el original (spec 2026-07-23).
      vocalization:
        words.length === 0 ||
        (confidence !== null && confidence < VOCALIZATION_CONFIDENCE_THRESHOLD),
      breath: false,
      manualStartMs: null,
    };
  };
  const first = mk(tokens.slice(0, afterWord + 1).join(' '), aligned ? line.words.slice(0, afterWord + 1) : []);
  const second = mk(tokens.slice(afterWord + 1).join(' '), aligned ? line.words.slice(afterWord + 1) : []);
  // El primero conserva el respiro/offset manual del original solo si aplica
  // al inicio (manualStartMs ancla el ARRANQUE del renglón).
  first.manualStartMs = line.manualStartMs;
  second.breath = line.breath; // el respiro estaba DESPUES del renglón original
  first.breath = false;
  return [first, second];
}

export function splitLineRecursive(line) {
  if (line.text.length <= KARAOKE_MAX_CHARS) return [line];
  const tokens = line.text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [line];
  const aligned = Array.isArray(line.words) && line.words.length === tokens.length;
  let afterWord;
  if (aligned) {
    const breaks = suggestLineBreaks(line.words);
    if (breaks.length > 0) afterWord = closestToMiddle(breaks, tokens, line.text.length);
  }
  if (afterWord === undefined) {
    const allIndices = tokens.slice(0, -1).map((_, i) => i);
    afterWord = closestToMiddle(allIndices, tokens, line.text.length);
  }
  const [first, second] = splitLineAtWord(line, afterWord);
  return [...splitLineRecursive(first), ...splitLineRecursive(second)];
}

/**
 * Auto-parte renglones > KARAOKE_MAX_CHARS (doc v2: las words viven en cada
 * renglón, la correlación ya no necesita mapa externo). Pura e idempotente.
 */
export function autoSplitLongLines(doc) {
  const next = structuredClone(doc);
  for (const section of next.sections) {
    section.lines = section.lines.flatMap((line) => splitLineRecursive(line));
  }
  return next;
}
