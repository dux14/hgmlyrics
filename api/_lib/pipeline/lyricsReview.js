/**
 * lyricsReview.js — Dominio del gate humano de letra (doc v2, editor puro).
 * Ensambla el documento de revisión SOLO desde la IA: transcripción +
 * segmentos de estructura (SongFormer). Sin `songs.sections`, sin letra
 * canónica, sin diff/conflictos/temperatura (esa maquinaria de reconciliación
 * se eliminó a propósito en F2, ver spec 2026-07-23). El admin edita el
 * documento con `applyReviewAction` (partir/unir/mover/borrar renglones,
 * retipar/renombrar secciones, marcar respiro/vocalización, offset manual).
 * Dominio PURO: sin sql, sin fetch, sin Date.now. Patrón hermano de state.js
 * y phrasing.js en este mismo directorio.
 */
import { createHash } from 'node:crypto';
import { collapseSegments, collapseBySeed } from './structureShape.js';
import { seedIndex, monotonicAlign } from './seedLyrics.js';
import {
  autoSplitLongLines,
  splitAtSectionBoundaries,
  splitBySeed,
  splitLineAtWord,
  splitLineByText,
  lineConfidence,
  VOCALIZATION_CONFIDENCE_THRESHOLD,
} from './lyricsSplit.js';

// Idiomas soportados por la partitura vocal (align_app.py ya no autodetecta:
// el admin elige aquí y el idioma viaja pegado a la letra aprobada).
const SUPPORTED_LANGUAGES = ['es', 'en'];

// Normalización mínima de tipo de sección, DUPLICADA a propósito (ver header
// de src/lib/sectionTypes.js: la lógica se duplica ahí mismo para que
// ImmersiveView no dependa de SongView; misma razón aplica aquí al revés,
// api/_lib no debe acoplarse al árbol de src/). Solo lo que este módulo
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

// eqeqeq del repo no admite `!= null`; helper explícito para null/undefined.
// Exportado: lo reusa api/songs/[id]/pipeline/lyrics.js (evita duplicarlo).
export function isNil(value) {
  return value === null || value === undefined;
}

// Sin el chequeo de entero, `doc.sections['__proto__']` devuelve
// Array.prototype (truthy): el guard `if (!section)` de abajo no dispara y
// la acción sigue mutando el prototipo global en vez de fallar (Important
// de seguridad, review tanda C — ver requireInt más abajo, mismo criterio
// que ya se aplicaba a afterWord/toLine/startMs).
function requireSection(doc, sectionIdx) {
  requireInt(sectionIdx, 'section');
  const section = doc.sections[sectionIdx];
  if (!section) throw new RangeError(`Sección fuera de rango: ${sectionIdx}`);
  return section;
}

function requireLine(section, lineIdx) {
  requireInt(lineIdx, 'line');
  const line = section.lines[lineIdx];
  if (!line) throw new RangeError(`Renglón fuera de rango: ${lineIdx}`);
  return line;
}

/** Renglón nuevo: sin words a propósito — un renglón insertado o duplicado no
 * puede reclamar el instante de audio de otro (ver §5.4 del spec). El tiempo lo
 * interpola timingLinesFromSections al aprobar. */
function emptyLine() {
  return {
    text: '',
    startMs: null,
    endMs: null,
    words: [],
    confidence: null,
    vocalization: false,
    breath: false,
    manualStartMs: null,
  };
}

// Cuenta de tokens por espacios en blanco (mismo criterio que buildSuggestions
// y splitLineByText en lyricsSplit.js): usado para detectar si `words` sigue
// alineado 1:1 con el texto tras una edición (#6).
// Exportado: songbookSync.js la reusa para el mismo criterio de descarte de
// `words` al propagar texto editado del cancionero.
export function tokenCount(text) {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

// Los índices de acción (afterWord, etc.) se usan tanto como índice de array
// (donde undefined/NaN/no-entero simplemente no calzan y ya revientan vía
// requireSection/Line) como en comparaciones aritméticas (`< 0`, `>= len-1`)
// que con undefined/NaN dan siempre `false` y DEJAN PASAR el valor inválido
// — ahí hace falta esta guarda explícita.
function requireInt(value, name) {
  if (!Number.isInteger(value)) throw new RangeError(`${name} inválido: ${value}`);
  return value;
}

// Etiqueta ES normalizada (SongFormer, ver _LABEL_MAP de
// modal/sections/songformer.py) -> tipo de sección de LETRA. 'instrumental'
// y 'silencio' no tienen equivalente lírico -- no generan sección de letra.
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

// Secciones líricas desde los segmentos SongFormer: solo labels mapeables
// (instrumental/silencio no generan sección de letra).
function lyricSectionsFromSegments(structureSegments) {
  const sections = [];
  for (const seg of structureSegments ?? []) {
    const type = STRUCTURE_LABEL_TO_SECTION_TYPE[seg.label];
    if (!type) continue;
    sections.push({ type, label: null, startMs: seg.startMs, endMs: seg.endMs, lines: [] });
  }
  return sections;
}

// Índice de la sección con MAYOR solape temporal con [startMs, endMs]; sin
// solape (el renglón cae en un tramo instrumental), la lírica más CERCANA.
function bestSectionIndex(sections, startMs, endMs) {
  let best = -1;
  let bestOverlap = 0;
  sections.forEach((sec, i) => {
    const overlap = Math.min(endMs, sec.endMs) - Math.max(startMs, sec.startMs);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = i;
    }
  });
  if (best !== -1) return best;
  const mid = (startMs + endMs) / 2;
  let nearest = 0;
  let nearestDist = Infinity;
  sections.forEach((sec, i) => {
    const dist = mid < sec.startMs ? sec.startMs - mid : mid > sec.endMs ? mid - sec.endMs : 0;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = i;
    }
  });
  return nearest;
}

// Envelope temporal [startMs,endMs] de una sección desde sus renglones con
// timing; si ninguno tiene timing usa el fallback (el envelope previo).
function sectionEnvelope(lines, fallback) {
  const timed = lines.filter((l) => l.startMs !== null && l.endMs !== null);
  if (timed.length === 0) return { startMs: fallback.startMs, endMs: fallback.endMs };
  return {
    startMs: Math.min(...timed.map((l) => l.startMs)),
    endMs: Math.max(...timed.map((l) => l.endMs)),
  };
}

/**
 * Construye el documento de revisión v2 SOLO desde la IA: secciones =
 * segmentos SongFormer, renglones = transLines asignados por solape temporal.
 * Sin songs.sections, sin canónica, sin conflictos (spec 2026-07-23).
 * @param {{transcription: {transLines?: string[], words?: Array, perLine?: Array}, structureSegments?: Array, seedSections?: Array|null}} args
 * @returns {object} doc v2 (ver plan de decisiones transversales)
 */
export function buildReviewDoc({ transcription, structureSegments = [], seedSections = null }) {
  const transLines = transcription?.transLines ?? [];
  const allWords = transcription?.words ?? [];
  const wordsPerTransIndex = wordsByTransIndex(transLines, allWords);
  // Semilla del cancionero: índice plano + alineamiento monótono contra
  // perLine, único punto donde el transIndex todavía existe (H3).
  // Sin semilla (caso más común, canción aún no publicada) no hay contra qué
  // alinear: monotonicAlign(perLine) nunca se consulta más abajo (`seed.length
  // ? alignment.get(...) : null`) — evitamos el trabajo directamente.
  const seed = seedIndex(seedSections);
  const alignment = new Map(
    seed.length ? monotonicAlign(transcription?.perLine ?? []).map((p) => [p.transIndex, p]) : [],
  );

  let sections = lyricSectionsFromSegments(collapseSegments(structureSegments));
  if (sections.length === 0) {
    const lastWord = allWords[allWords.length - 1];
    sections = [{ type: 'verse', label: null, startMs: 0, endMs: lastWord?.endMs ?? 0, lines: [] }];
  }

  // Fase 1: un renglón por segmento transcrito, sin asignar todavía.
  const rawLines = transLines.map((text, transIndex) => {
    const words = (wordsPerTransIndex.get(transIndex) ?? []).map((w) => ({
      word: w.word ?? '',
      startMs: w.startMs,
      endMs: w.endMs,
      score: typeof w.score === 'number' ? w.score : null,
    }));
    const startMs = words.length ? words[0].startMs : null;
    const endMs = words.length ? words[words.length - 1].endMs : null;
    const confidence = lineConfidence(words);
    return {
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
    };
  });

  // Fase 2: cortar en frontera de sección, heredar cortes de la semilla,
  // después por largo/respiración, y recién ahí asignar cada renglón
  // RESULTANTE por solape (H1: antes se asignaba el segmento entero y el
  // split posterior no volvía a repartir).
  let lastSectionIdx = 0;
  for (const [transIndex, raw] of rawLines.entries()) {
    const match = seed.length ? (alignment.get(transIndex) ?? null) : null;
    const pieces = splitAtSectionBoundaries(raw, sections).flatMap((boundaryPiece, boundaryIdx) => {
      // Solo la PRIMERA pieza de una frontera de sección hereda el match del
      // renglón completo: las siguientes ya son un fragmento temporal
      // posterior cuyo dbIndex real no puede derivarse sin volver a alinear
      // -- reusar el mismo dbIndex ahí producía cortes espurios (blocker
      // tanda C: la segunda pieza consumía líneas de semilla que en realidad
      // pertenecían a la primera).
      const boundaryMatch = boundaryIdx === 0 ? match : null;
      return splitBySeed(boundaryPiece, boundaryMatch, seed).flatMap((seedPiece) => {
        const longPieces = autoSplitLongLines({
          version: 2,
          sections: [{ lines: [seedPiece] }],
        }).sections[0].lines;
        // autoSplitLongLines reconstruye cada mitad desde cero
        // (splitLineAtWord) y no copia campos ajenos al v2: el tag de
        // semilla (ya correcto por pieza, ver splitBySeed) se re-adjunta aquí.
        if (!isNil(seedPiece.seedSectionIdx)) {
          for (const l of longPieces) l.seedSectionIdx = seedPiece.seedSectionIdx;
        }
        return longPieces;
      });
    });
    for (const piece of pieces) {
      const sIdx =
        piece.startMs === null
          ? lastSectionIdx
          : bestSectionIndex(sections, piece.startMs, piece.endMs);
      lastSectionIdx = sIdx;
      sections[sIdx].lines.push(piece);
    }
  }

  // Colapso guiado por semilla: fusiona secciones adyacentes cuyos renglones
  // alineados apuntan a la misma sección del cancionero (H4), antes de
  // recalcular el envelope real de cada sección.
  const collapsed = collapseBySeed({ version: 2, sections }, seed);
  for (const section of collapsed.sections) {
    const env = sectionEnvelope(section.lines, { startMs: section.startMs, endMs: section.endMs });
    section.startMs = env.startMs;
    section.endMs = env.endMs;
  }

  // El idioma no se adivina (sin autodetección en align_app.py): el admin lo
  // elige en el gate vía setLanguage; 'es' es el default del gate.
  collapsed.language = 'es';
  return collapsed;
}

/** Editor puro: aprobable con al menos un renglón y ninguno vacío (insertLine
 * permite dejar uno colgado; un renglón vacío aprobado ensucia el cancionero y
 * la partitura por sílaba). */
export function canApprove(doc) {
  if (!Array.isArray(doc?.sections)) return false;
  const lines = doc.sections.flatMap((s) => s.lines ?? []);
  return lines.length > 0 && lines.every((l) => typeof l.text === 'string' && l.text.trim() !== '');
}

/**
 * Snapshot aprobado para el store song_pipeline_lyrics: las sections v2 +
 * hash sha256 determinístico (stableStringify se conserva de v1).
 * `seedSectionIdx` (interno, solo tiene sentido mientras buildReviewDoc
 * arma el documento) se saca del snapshot persistido.
 */
export function approvedSnapshot(doc) {
  const sections = structuredClone(doc.sections).map((section) => ({
    ...section,
    lines: section.lines.map((line) => {
      const rest = { ...line };
      delete rest.seedSectionIdx;
      return rest;
    }),
  }));
  const hash = createHash('sha256').update(stableStringify(sections)).digest('hex');
  return { sections, hash };
}

/**
 * Aplica una acción de revisión sobre el documento y devuelve un documento
 * NUEVO (no muta `doc`). Acción sobre un índice inexistente lanza RangeError.
 * @param {object} doc documento previo (de buildReviewDoc o de una acción anterior)
 * @param {object} action
 * @returns {object} documento nuevo
 */
export function applyReviewAction(doc, action) {
  const next = structuredClone(doc);
  switch (action.type) {
    // editLine cambia SOLO el texto: conserva words/timing/confidence/
    // vocalización a propósito (una corrección menor no debe destruir el
    // timing de karaoke por un typo). Re-derivar confidence/vocalización tras
    // una edición mayor es decisión de F4 (resolución de fuente del karaoke),
    // cuando exista el store; no se resuelve en F2. EXCEPCIÓN (#6, review):
    // si la cantidad de tokens cambió (el admin acortó/alargó el renglón),
    // words ya no corresponde 1:1 al texto nuevo — pipelineLinesFor toma
    // endMs de la ÚLTIMA word para acotar el segmento del forced align, así
    // que arrastrar words viejas manda un rango mucho más largo (o corto) que
    // el renglón real. buildSuggestions/splitLineByText ya se protegen
    // comparando longitudes; acá se descartan las words para que
    // pipelineLinesFor caiga al fallback (startMs de la línea siguiente).
    case 'editLine': {
      const line = requireLine(requireSection(next, action.section), action.line);
      if (typeof action.text !== 'string' || action.text.trim() === '') {
        throw new RangeError(`text inválido: ${action.text}`);
      }
      line.text = action.text;
      if (Array.isArray(line.words) && line.words.length !== tokenCount(action.text)) {
        line.words = [];
      }
      break;
    }
    // setLineText (P2): el admin escribe un salto de línea en el editor.
    // Sin \n, splitLineByText devuelve un renglón (equivale a editLine); con
    // \n devuelve un array de piezas que reemplaza al renglón original.
    case 'setLineText': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      if (typeof action.text !== 'string' || action.text.trim() === '') {
        throw new RangeError(`text inválido: ${action.text}`);
      }
      const pieces = splitLineByText(line, action.text);
      // Misma excepción que editLine: splitLineByText solo reparte words
      // cuando el conteo de tokens de la pieza coincide (frontera/glued); si
      // alguna pieza quedó con words desalineadas por otra vía, se descartan.
      for (const piece of pieces) {
        if (Array.isArray(piece.words) && piece.words.length !== tokenCount(piece.text)) {
          piece.words = [];
        }
      }
      section.lines.splice(action.line, 1, ...pieces);
      break;
    }
    // setLanguage (P1): el idioma no se adivina, viaja pegado a la letra
    // aprobada. No toca approvedSnapshot/hash (sigue hasheando solo sections).
    case 'setLanguage': {
      if (!SUPPORTED_LANGUAGES.includes(action.language)) {
        throw new RangeError(`language inválido: ${action.language}`);
      }
      next.language = action.language;
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
        throw new RangeError(`label inválido: ${action.label}`);
      }
      section.label = action.label === null ? null : action.label.trim() || null;
      break;
    }
    case 'setBreath': {
      requireLine(requireSection(next, action.section), action.line).breath =
        action.breath === true;
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
      // Ultima línea como corte dejaría la sección nueva vacía: inválido.
      if (action.afterLine === section.lines.length - 1) {
        throw new RangeError(`afterLine deja la sección nueva vacía: ${action.afterLine}`);
      }
      const origEnv = { startMs: section.startMs, endMs: section.endMs };
      const remainder = section.lines.splice(action.afterLine + 1);
      const firstEnv = sectionEnvelope(section.lines, origEnv);
      section.startMs = firstEnv.startMs;
      section.endMs = firstEnv.endMs;
      const newEnv = sectionEnvelope(remainder, origEnv);
      next.sections.splice(action.section + 1, 0, {
        type: section.type,
        label: section.label,
        startMs: newEnv.startMs,
        endMs: newEnv.endMs,
        lines: remainder,
      });
      break;
    }
    case 'insertLine': {
      const section = requireSection(next, action.section);
      const at = requireInt(action.at, 'at');
      if (at < 0 || at > section.lines.length) {
        throw new RangeError(`at fuera de rango: ${at}`);
      }
      section.lines.splice(at, 0, emptyLine());
      break;
    }
    // La copia hereda SOLO texto y vocalización. Si arrastrara los milisegundos
    // del original, dos renglones reclamarían el mismo instante del audio y la
    // partitura por sílaba (modal/pitch, índice plano de renglón) saldría pisada.
    case 'duplicateLine': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      section.lines.splice(action.line + 1, 0, {
        ...emptyLine(),
        text: line.text,
        vocalization: line.vocalization === true,
      });
      break;
    }
    case 'mergeSections': {
      const section = requireSection(next, action.section);
      const nextSection = requireSection(next, action.section + 1);
      const fallback = {
        startMs: Math.min(section.startMs, nextSection.startMs),
        endMs: Math.max(section.endMs, nextSection.endMs),
      };
      section.lines.push(...nextSection.lines);
      const env = sectionEnvelope(section.lines, fallback);
      section.startMs = env.startMs;
      section.endMs = env.endMs;
      next.sections.splice(action.section + 1, 1);
      break;
    }
    case 'insertSection': {
      const at = requireInt(action.at, 'at');
      if (at < 0 || at > next.sections.length) {
        throw new RangeError(`at fuera de rango: ${at}`);
      }
      // Envelope colapsado en el borde de la vecina anterior: null envenenaría
      // el Math.min/Math.max de mergeSections y sectionEnvelope.
      const anchor = at === 0 ? 0 : (next.sections[at - 1]?.endMs ?? 0);
      next.sections.splice(at, 0, {
        type: normalizeSectionType(action.sectionType ?? 'verse'),
        label: null,
        startMs: anchor,
        endMs: anchor,
        lines: [],
      });
      break;
    }
    case 'duplicateSection': {
      const section = requireSection(next, action.section);
      next.sections.splice(action.section + 1, 0, {
        type: section.type,
        label: section.label,
        startMs: section.endMs,
        endMs: section.endMs,
        lines: section.lines.map((line) => ({
          ...emptyLine(),
          text: line.text,
          vocalization: line.vocalization === true,
        })),
      });
      break;
    }
    // Borrar una sección nunca borra texto: sus renglones se reubican en la
    // vecina (la anterior; la siguiente si era la primera).
    case 'deleteSection': {
      const section = requireSection(next, action.section);
      if (next.sections.length === 1) {
        throw new RangeError('no se puede borrar la única sección');
      }
      const targetIdx = action.section === 0 ? 1 : action.section - 1;
      const target = next.sections[targetIdx];
      const fallback = {
        startMs: Math.min(section.startMs, target.startMs),
        endMs: Math.max(section.endMs, target.endMs),
      };
      if (action.section === 0) target.lines.unshift(...section.lines);
      else target.lines.push(...section.lines);
      const env = sectionEnvelope(target.lines, fallback);
      target.startMs = env.startMs;
      target.endMs = env.endMs;
      next.sections.splice(action.section, 1);
      break;
    }
    default:
      throw new RangeError(`Acción de revisión desconocida: ${action.type}`);
  }
  return next;
}
