/**
 * lyricsReview.js — Dominio del gate humano de letra (plan C, task C1).
 * Convierte las 3 fuentes de un run (letra guardada en `songs.sections`,
 * letra canonica del catalogo si existe, transcripcion de Modal con su diff
 * por linea) en un documento de revision editable, y aplica las acciones que
 * el admin puede tomar sobre ese documento (resolver conflictos, partir/unir
 * renglones, aceptar/rechazar vocalizaciones, retipar/partir/unir secciones).
 * Dominio PURO: sin sql, sin fetch, sin Date.now. Patron hermano de state.js
 * y phrasing.js en este mismo directorio.
 */
import { createHash } from 'node:crypto';
import { normalizeSectionType } from '../../../src/lib/sectionTypes.js';

// Score por defecto cuando una linea en conflicto no tiene score de trans
// (p.ej. lineas nacidas de un splitLine, sin contraparte en perLine).
const FALLBACK_CONFLICT_SCORE = 0.5;

/** Misma logica que normalize_for_compare de modal/transcribe_diff.py:
 * NFD + minusculas + sin diacriticos/puntuacion + espacios colapsados. */
function normalize(text) {
  const t = (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// Empareja cada seccion db con su seccion canonica del mismo tipo, en orden
// de aparicion (tipo->tipo, 1a con 1a, 2a con 2a, etc). Sin canonica o sin
// mas secciones canonicas de ese tipo, devuelve null (esa seccion queda sin
// contraparte canonica).
function matchCanonicalSections(dbSections, canonical) {
  if (!canonical || !Array.isArray(canonical.secciones)) return dbSections.map(() => null);
  const byType = new Map();
  for (const cs of canonical.secciones) {
    const t = normalizeSectionType(cs.tipo);
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(cs);
  }
  const used = new Map();
  return dbSections.map((db) => {
    const t = normalizeSectionType(db.type);
    const list = byType.get(t);
    if (!list) return null;
    const idx = used.get(t) || 0;
    if (idx >= list.length) return null;
    used.set(t, idx + 1);
    return list[idx];
  });
}

// Empareja lineas db<->canonicas dentro de una seccion ya emparejada por
// tipo. Igual cantidad: 1 a 1 por posicion. Distinta cantidad: primero
// exacta por normalize(), el resto se asigna posicionalmente entre lo que
// quede libre (mejor esfuerzo; el resto sin match queda null).
function matchLines(dbLines, canonLines) {
  if (dbLines.length === canonLines.length) {
    return dbLines.map((_, i) => canonLines[i]);
  }
  const result = new Array(dbLines.length).fill(null);
  const usedCanon = new Set();
  dbLines.forEach((dbText, i) => {
    const dbNorm = normalize(dbText);
    const idx = canonLines.findIndex((c, ci) => !usedCanon.has(ci) && normalize(c) === dbNorm);
    if (idx !== -1) {
      result[i] = canonLines[idx];
      usedCanon.add(idx);
    }
  });
  dbLines.forEach((_, i) => {
    if (result[i] !== null) return;
    const idx = canonLines.findIndex((_c, ci) => !usedCanon.has(ci));
    if (idx !== -1) {
      result[i] = canonLines[idx];
      usedCanon.add(idx);
    }
  });
  return result;
}

// Peso de una linea para el promedio de temperatura: las lineas de
// vocalizacion no cuentan (no son parte del gate de letra en si).
function lineWeight(line) {
  if (line.vocalization) return null;
  if (!line.conflict) return 1.0;
  return line.score != null ? line.score : FALLBACK_CONFLICT_SCORE;
}

function sectionTemperature(section) {
  let sum = 0;
  let count = 0;
  for (const line of section.lines) {
    const w = lineWeight(line);
    if (w === null) continue;
    sum += w;
    count += 1;
  }
  return count ? round4(sum / count) : 1;
}

// Calcula y fija doc.sections[i].temperature y doc.temperature en el doc
// dado (mutacion in-place: se llama siempre sobre un doc recien clonado).
function recomputeTemperatures(doc) {
  let sum = 0;
  let count = 0;
  for (const section of doc.sections) {
    section.temperature = sectionTemperature(section);
    for (const line of section.lines) {
      const w = lineWeight(line);
      if (w === null) continue;
      sum += w;
      count += 1;
    }
  }
  doc.temperature = count ? round4(sum / count) : 1;
}

/**
 * Construye el documento de revision a partir de las 3 fuentes de un run.
 * @param {{dbSections: Array, canonical: {secciones: Array}|null,
 *   transcription: {text:string, words:Array, perLine:Array,
 *   transLines?: string[]}}} args
 * @returns {object} documento de revision (editable via applyReviewAction)
 */
export function buildReviewDoc({ dbSections, canonical, transcription }) {
  const transLines = transcription?.transLines ?? [];
  const perLine = transcription?.perLine ?? [];

  // Flatten de lineas db (orden documento) para casar contra perLine.dbIndex,
  // que indexa sobre el flat de todas las lineas db del run.
  const flatDbLines = [];
  dbSections.forEach((section, sIdx) => {
    section.lines.forEach((line, lIdx) => {
      flatDbLines.push({ section: sIdx, line: lIdx, text: line.text });
    });
  });

  const perLineByDbIndex = new Map();
  for (const p of perLine) {
    if (p.dbIndex === null || p.dbIndex === undefined) continue;
    const existing = perLineByDbIndex.get(p.dbIndex);
    if (!existing || p.score > existing.score) perLineByDbIndex.set(p.dbIndex, p);
  }

  const canonicalPerSection = matchCanonicalSections(dbSections, canonical);

  const sections = dbSections.map((section, sIdx) => {
    const canonSection = canonicalPerSection[sIdx];
    const canonLines = canonSection?.lineas?.map((l) => l.texto) ?? [];
    const matchedCanon = matchLines(section.lines.map((l) => l.text), canonLines);

    const lines = section.lines.map((line, lIdx) => {
      const flatIndex = flatDbLines.findIndex((f) => f.section === sIdx && f.line === lIdx);
      const perLineEntry = perLineByDbIndex.get(flatIndex) ?? null;
      const transText = perLineEntry ? (transLines[perLineEntry.transIndex] ?? null) : null;
      const canonicalText = matchedCanon[lIdx];
      const conflict = canonicalText != null && normalize(line.text) !== normalize(canonicalText);
      return {
        text: line.text,
        conflict,
        vocalization: false,
        score: perLineEntry ? perLineEntry.score : null,
        sources: { db: line.text, canonical: canonicalText, trans: transText },
        ...(line.chords ? { chords: line.chords } : {}),
        ...(line.groups ? { groups: line.groups } : {}),
      };
    });

    return { type: section.type, label: section.label, lines, temperature: 1 };
  });

  // Vocalizaciones: segmentos transcritos sin dbIndex asociado.
  const vocalizations = [];
  let lastMatchedFlat = null;
  for (const p of perLine) {
    if (p.dbIndex === null || p.dbIndex === undefined) {
      const flatAnchor = flatDbLines[lastMatchedFlat] ?? null;
      vocalizations.push({
        text: transLines[p.transIndex] ?? '',
        anchorAfterLine: flatAnchor ? { section: flatAnchor.section, line: flatAnchor.line } : null,
        accepted: null,
      });
    } else {
      lastMatchedFlat = p.dbIndex;
    }
  }

  const doc = { sections, vocalizations, hasCanonical: canonical != null, temperature: 1 };
  recomputeTemperatures(doc);
  return doc;
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

function requireVocalization(doc, index) {
  const vocalization = doc.vocalizations[index];
  if (!vocalization) throw new RangeError(`Vocalizacion fuera de rango: ${index}`);
  return vocalization;
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
    case 'resolve': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      if (action.choice === 'canonical') line.text = line.sources.canonical;
      else if (action.choice === 'db') line.text = line.sources.db;
      else if (action.choice === 'edit') line.text = action.text;
      line.conflict = false;
      break;
    }
    case 'splitLine': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      const words = line.text.split(/\s+/).filter(Boolean);
      // afterWord es el indice (0-based) de la ultima palabra que queda en
      // el primer renglon; el resto pasa al segundo.
      const first = words.slice(0, action.afterWord + 1).join(' ');
      const second = words.slice(action.afterWord + 1).join(' ');
      const firstLine = { ...line, text: first };
      const secondLine = { ...line, text: second };
      section.lines.splice(action.line, 1, firstLine, secondLine);
      break;
    }
    case 'mergeLines': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      const nextLine = requireLine(section, action.line + 1);
      const merged = { ...line, text: `${line.text} ${nextLine.text}`.trim() };
      section.lines.splice(action.line, 2, merged);
      break;
    }
    case 'acceptVocalization': {
      const vocalization = requireVocalization(next, action.index);
      const section = requireSection(next, action.section);
      requireLine(section, action.afterLine);
      vocalization.accepted = true;
      const newLine = {
        text: vocalization.text,
        conflict: false,
        vocalization: true,
        score: null,
        sources: { db: null, canonical: null, trans: vocalization.text },
      };
      section.lines.splice(action.afterLine + 1, 0, newLine);
      break;
    }
    case 'rejectVocalization': {
      const vocalization = requireVocalization(next, action.index);
      vocalization.accepted = false;
      break;
    }
    case 'setSectionType': {
      const section = requireSection(next, action.section);
      section.type = normalizeSectionType(action.sectionType);
      break;
    }
    case 'splitSection': {
      const section = requireSection(next, action.section);
      requireLine(section, action.afterLine);
      const remainder = section.lines.splice(action.afterLine + 1);
      const newSection = { type: section.type, label: section.label, lines: remainder, temperature: 1 };
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
  recomputeTemperatures(next);
  return next;
}

/** Temperatura global del documento (promedio de score por linea, 4 decimales). */
export function reviewTemperature(doc) {
  let sum = 0;
  let count = 0;
  for (const section of doc.sections) {
    for (const line of section.lines) {
      const w = lineWeight(line);
      if (w === null) continue;
      sum += w;
      count += 1;
    }
  }
  return count ? round4(sum / count) : 1;
}

/** true si no quedan conflictos sin resolver ni vocalizaciones sin decidir. */
export function canApprove(doc) {
  const hasConflict = doc.sections.some((s) => s.lines.some((l) => l.conflict));
  const hasUndecidedVocalization = doc.vocalizations.some((v) => v.accepted === null);
  return !hasConflict && !hasUndecidedVocalization;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Snapshot aprobado listo para persistir en `songs.sections`, con hash
 * deterministico (sha256 hex de un JSON canonico de claves ordenadas).
 * @param {object} doc
 * @returns {{sections: Array, hash: string}}
 */
export function approvedSnapshot(doc) {
  const sections = doc.sections.map((section) => ({
    type: section.type,
    ...(section.label !== undefined ? { label: section.label } : {}),
    lines: section.lines.map((line) => {
      const out = { text: line.text };
      if (line.chords) out.chords = line.chords;
      if (line.groups) out.groups = line.groups;
      if (line.vocalization) out.vocalization = true;
      return out;
    }),
  }));
  const hash = createHash('sha256').update(stableStringify(sections)).digest('hex');
  return { sections, hash };
}
