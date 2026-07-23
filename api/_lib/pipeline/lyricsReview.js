/**
 * lyricsReview.js — Dominio del gate humano de letra (doc v2, editor puro).
 * Ensambla el documento de revision SOLO desde la IA: transcripcion +
 * segmentos de estructura (SongFormer). Sin `songs.sections`, sin letra
 * canonica, sin diff/conflictos/temperatura (esa maquinaria de reconciliacion
 * se elimino a proposito en F2, ver spec 2026-07-23). El admin edita el
 * documento con `applyReviewAction` (partir/unir/mover/borrar renglones,
 * retipar/renombrar secciones, marcar respiro/vocalizacion, offset manual).
 * Dominio PURO: sin sql, sin fetch, sin Date.now. Patron hermano de state.js
 * y phrasing.js en este mismo directorio.
 */
import { createHash } from 'node:crypto';
import { suggestLineBreaks } from './phrasing.js';

// Umbral de largo para el gate karaoke (Task 14): un renglon mas largo que
// esto no cabe bien en el roll de letra sincronizada y se auto-parte.
const KARAOKE_MAX_CHARS = 48;

// Normalizacion minima de tipo de seccion, DUPLICADA a proposito (ver header
// de src/lib/sectionTypes.js: la logica se duplica ahi mismo para que
// ImmersiveView no dependa de SongView; misma razon aplica aca al reves,
// api/_lib no debe acoplarse al arbol de src/). Solo lo que este modulo
// necesita: agrupar por tipo y validar/normalizar el tipo de setSectionType.
const KNOWN_SECTION_TYPES = ['verse', 'chorus', 'bridge', 'prechorus', 'intro', 'outro'];
const SECTION_TYPE_ALIASES = {
  verso: 'verse',
  estribillo: 'chorus',
  coro: 'chorus',
  puente: 'bridge',
  'pre-estribillo': 'prechorus',
  'pre-coro': 'prechorus',
  precoro: 'prechorus',
};
function normalizeSectionType(type) {
  const slug = (type || '').toString().trim().toLowerCase();
  if (KNOWN_SECTION_TYPES.includes(slug)) return slug;
  return SECTION_TYPE_ALIASES[slug] || 'verse';
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// eqeqeq del repo no admite `!= null`; helper explicito para null/undefined.
// Exportado: lo reusa api/songs/[id]/pipeline/lyrics.js (evita duplicarlo).
export function isNil(value) {
  return value === null || value === undefined;
}

// Entre los indices de corte candidatos (afterWord, 0-based), elige el que
// deja el offset de caracter mas cercano a la mitad del texto del renglon.
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

function requireSection(doc, sectionIdx) {
  const section = doc.sections[sectionIdx];
  if (!section) throw new RangeError(`Seccion fuera de rango: ${sectionIdx}`);
  return section;
}

function requireLine(section, lineIdx) {
  const line = section.lines[lineIdx];
  if (!line) throw new RangeError(`Renglon fuera de rango: ${lineIdx}`);
  return line;
}

// Los indices de accion (afterWord, etc.) se usan tanto como indice de array
// (donde undefined/NaN/no-entero simplemente no calzan y ya revientan via
// requireSection/Line) como en comparaciones aritmeticas (`< 0`, `>= len-1`)
// que con undefined/NaN dan siempre `false` y DEJAN PASAR el valor invalido
// — ahi hace falta esta guarda explicita.
function requireInt(value, name) {
  if (!Number.isInteger(value)) throw new RangeError(`${name} invalido: ${value}`);
  return value;
}

// Etiqueta ES normalizada (SongFormer, ver _LABEL_MAP de
// modal/sections/songformer.py) -> tipo de seccion de LETRA. 'instrumental'
// y 'silencio' no tienen equivalente lirico -- no generan seccion de letra.
const STRUCTURE_LABEL_TO_SECTION_TYPE = {
  intro: 'intro',
  verso: 'verse',
  coro: 'chorus',
  puente: 'bridge',
  'pre-coro': 'prechorus',
  outro: 'outro',
};

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Timestamps por palabra de CADA segmento transcrito, indexados por
// transIndex. Los words vienen concatenados en el mismo orden que
// `transLines`, que es el orden TEMPORAL real del audio.
function wordsByTransIndex(transLines, words) {
  const map = new Map();
  let cursor = 0;
  transLines.forEach((lineText, transIndex) => {
    const count = (lineText || '').split(/\s+/).filter(Boolean).length;
    map.set(transIndex, words.slice(cursor, cursor + count));
    cursor += count;
  });
  return map;
}

// Umbral de confianza bajo el cual un renglon se marca vocalizacion
// automatica (segmento sin palabras claras, spec 2026-07-23).
const VOCALIZATION_CONFIDENCE_THRESHOLD = 0.4;

/** Promedio round4 del score por palabra; null sin scores numericos. */
function lineConfidence(words) {
  const scores = (words ?? []).map((w) => w.score).filter((s) => typeof s === 'number');
  if (scores.length === 0) return null;
  return round4(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// Secciones liricas desde los segmentos SongFormer: solo labels mapeables
// (instrumental/silencio no generan seccion de letra).
function lyricSectionsFromSegments(structureSegments) {
  const sections = [];
  for (const seg of structureSegments ?? []) {
    const type = STRUCTURE_LABEL_TO_SECTION_TYPE[seg.label];
    if (!type) continue;
    sections.push({ type, label: null, startMs: seg.startMs, endMs: seg.endMs, lines: [] });
  }
  return sections;
}

// Indice de la seccion con MAYOR solape temporal con [startMs, endMs]; sin
// solape (el renglon cae en un tramo instrumental), la lirica mas CERCANA.
function bestSectionIndex(sections, startMs, endMs) {
  let best = -1;
  let bestOverlap = 0;
  sections.forEach((sec, i) => {
    const overlap = Math.min(endMs, sec.endMs) - Math.max(startMs, sec.startMs);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
  });
  if (best !== -1) return best;
  const mid = (startMs + endMs) / 2;
  let nearest = 0;
  let nearestDist = Infinity;
  sections.forEach((sec, i) => {
    const dist = mid < sec.startMs ? sec.startMs - mid : mid > sec.endMs ? mid - sec.endMs : 0;
    if (dist < nearestDist) { nearestDist = dist; nearest = i; }
  });
  return nearest;
}

/**
 * Construye el documento de revision v2 SOLO desde la IA: secciones =
 * segmentos SongFormer, renglones = transLines asignados por solape temporal.
 * Sin songs.sections, sin canonica, sin conflictos (spec 2026-07-23).
 * @param {{transcription: {transLines?: string[], words?: Array}, structureSegments?: Array}} args
 * @returns {object} doc v2 (ver plan de decisiones transversales)
 */
export function buildReviewDoc({ transcription, structureSegments = [] }) {
  const transLines = transcription?.transLines ?? [];
  const allWords = transcription?.words ?? [];
  const wordsPerTransIndex = wordsByTransIndex(transLines, allWords);

  let sections = lyricSectionsFromSegments(structureSegments);
  if (sections.length === 0) {
    const lastWord = allWords[allWords.length - 1];
    sections = [{ type: 'verse', label: null, startMs: 0, endMs: lastWord?.endMs ?? 0, lines: [] }];
  }

  let lastSectionIdx = 0;
  transLines.forEach((text, transIndex) => {
    const words = (wordsPerTransIndex.get(transIndex) ?? []).map((w) => ({
      word: w.word ?? '',
      startMs: w.startMs,
      endMs: w.endMs,
      score: typeof w.score === 'number' ? w.score : null,
    }));
    const startMs = words.length ? words[0].startMs : null;
    const endMs = words.length ? words[words.length - 1].endMs : null;
    const confidence = lineConfidence(words);
    // Sin word-timing no hay intervalo que solapar: hereda la seccion del
    // renglon anterior (mantiene el orden temporal de transLines).
    const sIdx = startMs === null ? lastSectionIdx : bestSectionIndex(sections, startMs, endMs);
    lastSectionIdx = sIdx;
    sections[sIdx].lines.push({
      text,
      startMs,
      endMs,
      words,
      confidence,
      vocalization:
        words.length === 0 ||
        (confidence !== null && confidence < VOCALIZATION_CONFIDENCE_THRESHOLD),
      breath: false,
      manualStartMs: null,
    });
  });

  return autoSplitLongLines({ version: 2, sections });
}

// Parte una linea v2 en la palabra `afterWord` (0-based, ultima del primer
// renglon), repartiendo las words y recalculando timing/confidence de cada
// mitad. Words desalineadas con los tokens (texto editado a mano): ambas
// mitades salen sin words (timing heredado nulo) — ausente es mejor que stale.
function splitLineAtWord(line, afterWord) {
  const tokens = line.text.split(/\s+/).filter(Boolean);
  if (afterWord < 0 || afterWord >= tokens.length - 1) {
    throw new RangeError(`afterWord fuera de rango: ${afterWord}`);
  }
  const aligned = Array.isArray(line.words) && line.words.length === tokens.length;
  const mk = (text, words) => ({
    text,
    startMs: words.length ? words[0].startMs : null,
    endMs: words.length ? words[words.length - 1].endMs : null,
    words,
    confidence: lineConfidence(words),
    vocalization: line.vocalization,
    breath: false,
    manualStartMs: null,
  });
  const first = mk(tokens.slice(0, afterWord + 1).join(' '), aligned ? line.words.slice(0, afterWord + 1) : []);
  const second = mk(tokens.slice(afterWord + 1).join(' '), aligned ? line.words.slice(afterWord + 1) : []);
  // El primero conserva el respiro/offset manual del original solo si aplica
  // al inicio (manualStartMs ancla el ARRANQUE del renglon).
  first.manualStartMs = line.manualStartMs;
  second.breath = line.breath; // el respiro estaba DESPUES del renglon original
  first.breath = false;
  return [first, second];
}

function splitLineRecursive(line) {
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
 * renglon, la correlacion ya no necesita mapa externo). Pura e idempotente.
 */
export function autoSplitLongLines(doc) {
  const next = structuredClone(doc);
  for (const section of next.sections) {
    section.lines = section.lines.flatMap((line) => splitLineRecursive(line));
  }
  return next;
}

/** Editor puro: aprobable con al menos un renglon en alguna seccion. */
export function canApprove(doc) {
  return Array.isArray(doc?.sections) && doc.sections.some((s) => (s.lines ?? []).length > 0);
}

/**
 * Snapshot aprobado para el store song_pipeline_lyrics: las sections v2 tal
 * cual + hash sha256 deterministico (stableStringify se conserva de v1).
 */
export function approvedSnapshot(doc) {
  const sections = structuredClone(doc.sections);
  const hash = createHash('sha256').update(stableStringify(sections)).digest('hex');
  return { sections, hash };
}

/**
 * Aplica una accion de revision sobre el documento y devuelve un documento
 * NUEVO (no muta `doc`). Accion sobre un indice inexistente lanza RangeError.
 * @param {object} doc documento previo (de buildReviewDoc o de una accion anterior)
 * @param {object} action
 * @returns {object} documento nuevo
 */
export function applyReviewAction(doc, action) {
  const next = structuredClone(doc);
  switch (action.type) {
    case 'editLine': {
      const line = requireLine(requireSection(next, action.section), action.line);
      if (typeof action.text !== 'string' || action.text.trim() === '') {
        throw new RangeError(`text invalido: ${action.text}`);
      }
      line.text = action.text;
      break;
    }
    case 'splitLine': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      const afterWord = requireInt(action.afterWord, 'afterWord');
      const [first, second] = splitLineAtWord(line, afterWord);
      section.lines.splice(action.line, 1, first, second);
      break;
    }
    case 'mergeLines': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      const nextLine = requireLine(section, action.line + 1);
      const words = [...(line.words ?? []), ...(nextLine.words ?? [])];
      const merged = {
        text: `${line.text} ${nextLine.text}`.trim(),
        startMs: words.length ? words[0].startMs : (line.startMs ?? nextLine.startMs),
        endMs: words.length ? words[words.length - 1].endMs : (nextLine.endMs ?? line.endMs),
        words,
        confidence: lineConfidence(words),
        vocalization: line.vocalization && nextLine.vocalization,
        breath: nextLine.breath,
        manualStartMs: line.manualStartMs,
      };
      section.lines.splice(action.line, 2, merged);
      break;
    }
    case 'moveLine': {
      const from = requireSection(next, action.fromSection);
      const line = requireLine(from, action.fromLine);
      const to = requireSection(next, action.toSection);
      const toLine = requireInt(action.toLine, 'toLine');
      if (toLine < 0 || toLine > to.lines.length) {
        throw new RangeError(`toLine fuera de rango: ${toLine}`);
      }
      from.lines.splice(action.fromLine, 1);
      to.lines.splice(toLine, 0, line);
      break;
    }
    case 'deleteLine': {
      const section = requireSection(next, action.section);
      requireLine(section, action.line);
      section.lines.splice(action.line, 1);
      break;
    }
    case 'setSectionType': {
      requireSection(next, action.section).type = normalizeSectionType(action.sectionType);
      break;
    }
    case 'renameSection': {
      const section = requireSection(next, action.section);
      if (action.label !== null && typeof action.label !== 'string') {
        throw new RangeError(`label invalido: ${action.label}`);
      }
      section.label = action.label === null ? null : action.label.trim() || null;
      break;
    }
    case 'setBreath': {
      requireLine(requireSection(next, action.section), action.line).breath = action.breath === true;
      break;
    }
    case 'toggleVocalization': {
      const line = requireLine(requireSection(next, action.section), action.line);
      line.vocalization = !line.vocalization;
      break;
    }
    case 'setLineStart': {
      const line = requireLine(requireSection(next, action.section), action.line);
      if (action.startMs !== null) requireInt(action.startMs, 'startMs');
      line.manualStartMs = action.startMs;
      break;
    }
    case 'splitSection': {
      const section = requireSection(next, action.section);
      requireLine(section, action.afterLine);
      // Ultima linea como corte dejaria la seccion nueva vacia: invalido.
      if (action.afterLine === section.lines.length - 1) {
        throw new RangeError(`afterLine deja la seccion nueva vacia: ${action.afterLine}`);
      }
      const remainder = section.lines.splice(action.afterLine + 1);
      const newSection = { type: section.type, label: section.label, lines: remainder };
      next.sections.splice(action.section + 1, 0, newSection);
      break;
    }
    case 'mergeSections': {
      const section = requireSection(next, action.section);
      const nextSection = requireSection(next, action.section + 1);
      section.lines.push(...nextSection.lines);
      next.sections.splice(action.section + 1, 1);
      break;
    }
    default:
      throw new RangeError(`Accion de revision desconocida: ${action.type}`);
  }
  return next;
}

// F3: remover — el endpoint aun los importa; F3 migra el endpoint y estos
// mueren junto con la maquinaria de reconciliacion/temperatura que
// reemplazaba. Stubs minimos solo para no romper `pnpm build` (ver hazard
// documentado en el plan de F2).
export function reviewTemperature() {
  return 1;
}
export function computeStructureWarning() {
  return null;
}
