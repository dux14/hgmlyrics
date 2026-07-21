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

// Score por defecto cuando una linea en conflicto no tiene score de trans
// (p.ej. lineas nacidas de un splitLine, sin contraparte en perLine).
const FALLBACK_CONFLICT_SCORE = 0.5;

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

// eqeqeq del repo no admite `!= null`; helper explicito para null/undefined.
// Exportado: lo reusa api/songs/[id]/pipeline/lyrics.js (evita duplicarlo).
export function isNil(value) {
  return value === null || value === undefined;
}

// `songs.sections` real trae `lines: null` en secciones que no tienen letra
// propia (coros repetidos que referencian un coro anterior, ver "Primero el
// Cielo"). Normaliza a array vacio para poder iterar sin explotar.
function linesOf(section) {
  return Array.isArray(section.lines) ? section.lines : [];
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
// tipo. Igual cantidad: 1 a 1 por posicion (aunque el texto difiera, es la
// contraparte). Distinta cantidad: SOLO match por normalize()-igualdad
// exacta; la linea db que no encuentra exacta queda sin canonica (null) y
// el llamador la deja en conflicto (necesita atencion humana).
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
  return result;
}

// Peso de una linea para el promedio de temperatura: las lineas de
// vocalizacion no cuentan (no son parte del gate de letra en si).
function lineWeight(line) {
  if (line.vocalization) return null;
  if (!line.conflict) return 1.0;
  return isNil(line.score) ? FALLBACK_CONFLICT_SCORE : line.score;
}

function sectionTemperature(section) {
  let sum = 0;
  let count = 0;
  for (const line of linesOf(section)) {
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
    for (const line of linesOf(section)) {
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
    linesOf(section).forEach((line, lIdx) => {
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
    const hadCanonicalSection = !isNil(canonSection);
    const canonLines = canonSection?.lineas?.map((l) => l.texto) ?? [];
    const dbLines = linesOf(section);
    const matchedCanon = matchLines(dbLines.map((l) => l.text), canonLines);

    const lines = dbLines.map((line, lIdx) => {
      const flatIndex = flatDbLines.findIndex((f) => f.section === sIdx && f.line === lIdx);
      const perLineEntry = perLineByDbIndex.get(flatIndex) ?? null;
      const transText = perLineEntry ? (transLines[perLineEntry.transIndex] ?? null) : null;
      const canonicalText = matchedCanon[lIdx];
      // Con seccion canonica presente: conflicto si no hubo match (canonica
      // de distinta cantidad, sin exacta -> necesita atencion humana) o si
      // el texto normalizado difiere. Sin seccion canonica no hay con que
      // comparar, no es conflicto.
      const conflict = hadCanonicalSection
        && (isNil(canonicalText) || normalize(line.text) !== normalize(canonicalText));
      return {
        text: line.text,
        conflict,
        vocalization: false,
        score: perLineEntry ? perLineEntry.score : null,
        sources: { db: line.text, canonical: canonicalText, trans: transText },
        ...(line.chords ? { chords: line.chords } : {}),
        ...(line.groups ? { groups: line.groups } : {}),
        ...(line.voiceRanges ? { voiceRanges: line.voiceRanges } : {}),
      };
    });

    // `lines: null` en la fuente (coro repetido sin letra propia) se
    // recuerda para que approvedSnapshot pueda devolverla igual (ver ahi):
    // no inventamos un array vacio persistente donde antes no habia lineas.
    return {
      type: section.type,
      label: section.label,
      lines,
      temperature: 1,
      hadNullLines: !Array.isArray(section.lines),
    };
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

  const doc = { sections, vocalizations, hasCanonical: !isNil(canonical), temperature: 1 };
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

// Los indices de accion (afterWord, etc.) se usan tanto como indice de array
// (donde undefined/NaN/no-entero simplemente no calzan y ya revientan via
// requireSection/Line/Vocalization) como en comparaciones aritmeticas
// (`< 0`, `>= len-1`) que con undefined/NaN dan siempre `false` y DEJAN
// PASAR el valor invalido — ahi hace falta esta guarda explicita.
function requireInt(value, name) {
  if (!Number.isInteger(value)) throw new RangeError(`${name} invalido: ${value}`);
  return value;
}

// Incluye `key` en el objeto solo si `value` no es undefined — evita crear
// campos vacios/undefined donde la linea original no los tenia (regla 3 de
// C1: preservar la ausencia de chords/voiceRanges/groups).
function withOptionalField(key, value) {
  return value === undefined ? {} : { [key]: value };
}

// Reparte items anclados por posicion de caracter (chords: {pos}, ver
// voiceRanges abajo con {start,end}) segun un offset de corte de texto: los
// que caen antes del corte quedan en el primer renglon con su posicion sin
// tocar; los que caen en/despues pasan al segundo renglon con la posicion
// reajustada restando el offset. `keys` son los campos de posicion a
// reajustar; se clasifica por el primero (`pos` o `start`). Ausencia
// (undefined) se preserva como undefined en ambos lados, sin inventar
// arrays vacios.
function splitPositional(items, cutOffset, keys) {
  if (!items) return [undefined, undefined];
  const classifyKey = keys[0];
  const before = items.filter((it) => it[classifyKey] < cutOffset);
  const after = items
    .filter((it) => it[classifyKey] >= cutOffset)
    .map((it) => {
      const shifted = { ...it };
      for (const k of keys) shifted[k] -= cutOffset;
      return shifted;
    });
  return [before.length ? before : undefined, after.length ? after : undefined];
}

// Reajusta items posicionales sumandoles `offset` (usado al fusionar: la
// metadata del segundo renglon se corre por el largo del primero + separador).
function shiftPositional(items, offset, keys) {
  if (!items) return undefined;
  return items.map((it) => {
    const shifted = { ...it };
    for (const k of keys) shifted[k] += offset;
    return shifted;
  });
}

// Concatena dos listas opcionales sin inventar un array donde ambas fuentes
// son undefined (preserva la ausencia).
function concatOptional(a, b) {
  if (a === undefined && b === undefined) return undefined;
  return [...(a ?? []), ...(b ?? [])];
}

// Quita chords/voiceRanges/groups de una linea para reconstruir esos campos
// a mano (evita que el spread `...line` arrastre el array completo del
// original con posiciones invalidas para el renglon nuevo).
function stripPositionalFields(line) {
  const base = { ...line };
  delete base.chords;
  delete base.voiceRanges;
  delete base.groups;
  return base;
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
      else if (action.choice === 'edit') {
        // 'edit' sin texto (o vacio) corromperia line.text en silencio
        // (undefined) — se exige string no vacio.
        if (typeof action.text !== 'string' || action.text.trim() === '') {
          throw new RangeError(`text invalido para choice 'edit': ${action.text}`);
        }
        line.text = action.text;
      } else {
        throw new RangeError(`choice invalido: ${action.choice}`);
      }
      line.conflict = false;
      break;
    }
    case 'splitLine': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      const words = line.text.split(/\s+/).filter(Boolean);
      const afterWord = requireInt(action.afterWord, 'afterWord');
      // afterWord es el indice (0-based) de la ultima palabra que queda en
      // el primer renglon; el resto pasa al segundo. Fuera de [0, len-2]
      // dejaria un renglon vacio: invalido.
      if (afterWord < 0 || afterWord >= words.length - 1) {
        throw new RangeError(`afterWord fuera de rango: ${afterWord}`);
      }
      const first = words.slice(0, afterWord + 1).join(' ');
      const second = words.slice(afterWord + 1).join(' ');
      // Offset de corte en el texto: largo del prefijo + el separador (un
      // espacio) usado para unir las palabras del primer renglon. chords y
      // voiceRanges estan anclados por posicion de caracter en el texto
      // ORIGINAL — hay que repartirlos segun ese corte, no copiarlos enteros
      // a las dos mitades (eso invalidaria sus posiciones).
      const cutOffset = first.length + 1;
      const [chordsFirst, chordsSecond] = splitPositional(line.chords, cutOffset, ['pos']);
      const [voiceRangesFirst, voiceRangesSecond] = splitPositional(
        line.voiceRanges, cutOffset, ['start', 'end'],
      );
      // `groups` no tiene confirmado un unico campo de posicion como chords
      // (`pos`) o voiceRanges (`start`/`end`): ante la duda, conservador —
      // se queda entero en el primer renglon (no se duplica ni se pierde,
      // pero tampoco se reubica a ciegas sin saber su shape).
      const base = stripPositionalFields(line);
      const firstLine = {
        ...base,
        text: first,
        ...withOptionalField('chords', chordsFirst),
        ...withOptionalField('voiceRanges', voiceRangesFirst),
        ...withOptionalField('groups', line.groups),
      };
      const secondLine = {
        ...base,
        text: second,
        ...withOptionalField('chords', chordsSecond),
        ...withOptionalField('voiceRanges', voiceRangesSecond),
      };
      section.lines.splice(action.line, 1, firstLine, secondLine);
      break;
    }
    case 'mergeLines': {
      const section = requireSection(next, action.section);
      const line = requireLine(section, action.line);
      const nextLine = requireLine(section, action.line + 1);
      // Offset para reubicar la metadata del segundo renglon: largo del
      // texto del primero + el separador con el que se concatenan.
      const offset = line.text.length + 1;
      const mergedChords = concatOptional(line.chords, shiftPositional(nextLine.chords, offset, ['pos']));
      const mergedVoiceRanges = concatOptional(
        line.voiceRanges, shiftPositional(nextLine.voiceRanges, offset, ['start', 'end']),
      );
      // `groups`: mismo criterio conservador que en splitLine (shape de
      // posicion no confirmado) — se concatenan ambos arrays tal cual, sin
      // reubicar ningun campo.
      const mergedGroups = concatOptional(line.groups, nextLine.groups);
      const base = stripPositionalFields(line);
      const merged = {
        ...base,
        text: `${line.text} ${nextLine.text}`.trim(),
        ...withOptionalField('chords', mergedChords),
        ...withOptionalField('voiceRanges', mergedVoiceRanges),
        ...withOptionalField('groups', mergedGroups),
      };
      section.lines.splice(action.line, 2, merged);
      break;
    }
    case 'acceptVocalization': {
      const vocalization = requireVocalization(next, action.index);
      const section = requireSection(next, action.section);
      // afterLine -1 (o null/undefined, como llega anchorAfterLine:null de
      // una vocalizacion previa a cualquier linea matcheada) ancla al
      // inicio de la seccion; cualquier otro valor debe apuntar a una linea
      // existente.
      const afterLine = isNil(action.afterLine) ? -1 : action.afterLine;
      if (afterLine < -1) throw new RangeError(`afterLine fuera de rango: ${afterLine}`);
      if (afterLine !== -1) requireLine(section, afterLine);
      vocalization.accepted = true;
      const newLine = {
        text: vocalization.text,
        conflict: false,
        vocalization: true,
        score: null,
        sources: { db: null, canonical: null, trans: vocalization.text },
      };
      section.lines.splice(afterLine + 1, 0, newLine);
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
      // Ultima linea como corte dejaria la seccion nueva vacia: invalido.
      if (action.afterLine === section.lines.length - 1) {
        throw new RangeError(`afterLine deja la seccion nueva vacia: ${action.afterLine}`);
      }
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
    for (const line of linesOf(section)) {
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
  const hasConflict = doc.sections.some((s) => linesOf(s).some((l) => l.conflict));
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
  const sections = doc.sections.map((section) => {
    const currentLines = linesOf(section);
    // Seccion que llego con `lines: null` (coro repetido sin letra propia,
    // ver linesOf) y que nadie edito (no se le agregaron renglones en la
    // revision): se devuelve tal cual, `lines: null`, para no alterar la
    // semantica original en `songs.sections`. Si se le agrego contenido
    // (split, vocalizacion aceptada, etc.) ya deja de estar vacia y sale
    // como el resto de las secciones.
    const lines = (section.hadNullLines && currentLines.length === 0)
      ? null
      : currentLines.map((line) => {
        const out = { text: line.text };
        if (line.chords) out.chords = line.chords;
        if (line.groups) out.groups = line.groups;
        if (line.voiceRanges) out.voiceRanges = line.voiceRanges;
        if (line.vocalization) out.vocalization = true;
        return out;
      });
    return {
      type: section.type,
      ...(section.label !== undefined ? { label: section.label } : {}),
      lines,
    };
  });
  const hash = createHash('sha256').update(stableStringify(sections)).digest('hex');
  return { sections, hash };
}
