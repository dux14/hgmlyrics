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

// Parte una word en el offset de carácter dado (dentro de word.word),
// repartiendo su intervalo [startMs,endMs] proporcional a caracteres. Ambas
// mitades heredan el score. offset 0 o al final no parte nada -> RangeError.
export function splitWordAtChar(word, charOffset) {
  const text = word.word ?? '';
  if (charOffset <= 0 || charOffset >= text.length) {
    throw new RangeError(`charOffset fuera de rango: ${charOffset}`);
  }
  const duration = word.endMs - word.startMs;
  const splitMs = word.startMs + Math.round((duration * charOffset) / text.length);
  return [
    { word: text.slice(0, charOffset), startMs: word.startMs, endMs: splitMs, score: word.score },
    { word: text.slice(charOffset), startMs: splitMs, endMs: word.endMs, score: word.score },
  ];
}

/**
 * Aplica el texto editado por el admin a un renglón. Sin `\n`, equivale a
 * `editLine`: cambia solo `text`, conserva words/timing/confidence/
 * vocalización (se devuelve un renglón, no un arreglo). Con `\n`, parte en
 * tantas piezas como saltos queden tras colapsar saltos consecutivos y
 * espacios (nunca se crea una pieza vacía). El reparto de `words` sigue el
 * mismo criterio que splitLineAtWord: si el conteo de tokens del texto sin
 * saltos coincide con `words.length`, cada pieza se lleva sus words por
 * posición, y un corte que cae DENTRO de una palabra la divide con
 * splitWordAtChar. Si el conteo no coincide (texto editado a mano), todas
 * las piezas van sin words/confidence, con vocalización derivada.
 * @param {object} line renglón v2
 * @param {string} text texto nuevo, admite `\n` como separador de piezas
 * @returns {object|object[]}
 */
export function splitLineByText(line, text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new RangeError(`text inválido: ${text}`);
  }
  if (!text.includes('\n')) {
    return { ...line, text };
  }

  const rawTexts = text.split('\n');
  // tokens del texto SIN saltos (\n eliminado, no reemplazado por espacio):
  // un corte de frontera no cambia el conteo (ya había espacio ahí), uno
  // intra-palabra sí lo cambiaría si no se reconstruyera así.
  const collapsedTokens = text.replace(/\n/g, '').split(/\s+/).filter(Boolean);
  const aligned = Array.isArray(line.words) && line.words.length === collapsedTokens.length;

  const wordsCopy = aligned ? line.words.map((w) => ({ ...w })) : [];
  const wordSpans = [];
  if (aligned) {
    const collapsed = text.replace(/\n/g, '');
    const re = /\S+/g;
    let m = re.exec(collapsed);
    while (m) {
      wordSpans.push({ start: m.index, end: m.index + m[0].length });
      m = re.exec(collapsed);
    }
  }

  // Asigna cada word (o su mitad) al segmento crudo (entre saltos) donde cae,
  // en la coordenada del texto colapsado -- los segmentos no tienen \n
  // interno, así que su longitud coincide 1:1 con esa coordenada.
  const rawWords = rawTexts.map(() => []);
  let collapsedPos = 0;
  let wordCursor = 0;
  for (let i = 0; i < rawTexts.length; i += 1) {
    const segEnd = collapsedPos + rawTexts[i].length;
    while (aligned && wordCursor < wordSpans.length && wordSpans[wordCursor].start < segEnd) {
      const span = wordSpans[wordCursor];
      if (span.end <= segEnd) {
        rawWords[i].push(wordsCopy[wordCursor]);
        wordCursor += 1;
      } else {
        const localOffset = segEnd - span.start;
        const [firstHalf, secondHalf] = splitWordAtChar(wordsCopy[wordCursor], localOffset);
        rawWords[i].push(firstHalf);
        wordsCopy[wordCursor] = secondHalf;
        wordSpans[wordCursor] = { start: segEnd, end: span.end };
        break;
      }
    }
    collapsedPos = segEnd;
  }

  const mk = (pieceText, words) => {
    const confidence = lineConfidence(words);
    return {
      text: pieceText,
      startMs: words.length ? words[0].startMs : null,
      endMs: words.length ? words[words.length - 1].endMs : null,
      words,
      confidence,
      vocalization:
        words.length === 0 ||
        (confidence !== null && confidence < VOCALIZATION_CONFIDENCE_THRESHOLD),
      breath: false,
      manualStartMs: null,
    };
  };

  const pieces = [];
  rawTexts.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed === '') return; // saltos consecutivos / solo espacios: colapsan
    pieces.push(mk(trimmed, aligned ? rawWords[i] : []));
  });

  pieces[0].manualStartMs = line.manualStartMs;
  pieces[pieces.length - 1].breath = line.breath;
  return pieces;
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
 * Parte un renglón cada vez que sus palabras cruzan una frontera de sección.
 * El corte va ANTES de la primera palabra que arranca dentro de la sección
 * siguiente, usando el word-timing. Sin words alineadas a los tokens (texto
 * editado a mano) no parte: mismo criterio conservador que splitLineAtWord.
 * @param {object} line renglón v2
 * @param {Array<{startMs:number,endMs:number}>} sections secciones líricas
 * @returns {object[]} uno o más renglones, en orden temporal
 */
export function splitAtSectionBoundaries(line, sections) {
  const tokens = line.text.split(/\s+/).filter(Boolean);
  if (!Array.isArray(line.words) || line.words.length !== tokens.length) return [line];
  if (!sections || sections.length < 2) return [line];

  const sectionOf = (startMs) => {
    let idx = 0;
    sections.forEach((sec, i) => {
      if (sec.startMs <= startMs) idx = i;
    });
    return idx;
  };

  // Índices de palabra donde cambia la sección respecto de la anterior.
  const cuts = [];
  let current = sectionOf(line.words[0].startMs);
  for (let i = 1; i < line.words.length; i += 1) {
    const s = sectionOf(line.words[i].startMs);
    if (s !== current) {
      cuts.push(i - 1); // afterWord: última palabra del trozo previo
      current = s;
    }
  }
  if (cuts.length === 0) return [line];

  // Se parte de atrás hacia adelante para que los índices no se corran.
  let pieces = [line];
  for (const afterWord of [...cuts].reverse()) {
    const last = pieces[pieces.length - 1];
    const consumedBefore = pieces.slice(0, -1).reduce(
      (n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0,
    );
    const [first, second] = splitLineAtWord(last, afterWord - consumedBefore);
    pieces = [...pieces.slice(0, -1), first, second];
  }
  return pieces;
}

// Bajo este score, el match contra la semilla no es confiable para heredar
// cortes. Valor inicial derivado del run del 24-jul (erratas reales al
// 57-66%); calibrable con el primer run posterior a esta tanda.
export const SEED_INHERIT_MIN_SCORE = 0.6;

// Etiqueta cada pieza con la sección de origen de la línea de semilla que
// consumió (por posición: la pieza i corresponde a seed[match.dbIndex + i] --
// un corte por línea de semilla consumida entera, más el resto en la
// última). Sin esto, todas las piezas heredaban el sectionIdx de
// match.dbIndex fijo, mal-etiquetando la segunda mitad cuando el renglón
// cubre líneas de semilla de secciones distintas (blocker tanda C, ver
// collapseBySeed en structureShape.js).
function tagPiecesWithSeedSection(pieces, dbIndexStart, seed) {
  return pieces.map((piece, i) => {
    const origin = seed[dbIndexStart + i];
    return origin ? { ...piece, seedSectionIdx: origin.sectionIdx } : piece;
  });
}

/**
 * Hereda los cortes de renglón de la semilla: si el renglón transcrito cubre
 * varias líneas consecutivas del cancionero a partir de `match.dbIndex`, se
 * parte en esas fronteras, ubicando el punto por conteo acumulado de palabras.
 * @param {object} line renglón v2
 * @param {{dbIndex:number,score:number}|null} match del alineamiento monótono
 * @param {Array<{dbIndex:number,sectionIdx:number,text:string}>} seed salida de seedIndex
 * @returns {object[]}
 */
export function splitBySeed(line, match, seed) {
  if (!match || match.score < SEED_INHERIT_MIN_SCORE) return [line];
  const tokens = line.text.split(/\s+/).filter(Boolean);
  if (!Array.isArray(line.words) || line.words.length !== tokens.length) {
    return tagPiecesWithSeedSection([line], match.dbIndex, seed);
  }

  // Cuántas palabras aporta cada línea de la semilla desde el match, mientras
  // quepan en el renglón transcrito.
  const cuts = [];
  let consumed = 0;
  for (let d = match.dbIndex; d < seed.length; d += 1) {
    const count = seed[d].text.split(/\s+/).filter(Boolean).length;
    consumed += count;
    if (consumed >= tokens.length) break;
    cuts.push(consumed - 1); // afterWord absoluto
  }
  if (cuts.length === 0) return tagPiecesWithSeedSection([line], match.dbIndex, seed);

  let pieces = [line];
  for (const afterWord of [...cuts].reverse()) {
    const last = pieces[pieces.length - 1];
    const before = pieces.slice(0, -1).reduce(
      (n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0,
    );
    const [first, second] = splitLineAtWord(last, afterWord - before);
    pieces = [...pieces.slice(0, -1), first, second];
  }
  return tagPiecesWithSeedSection(pieces, match.dbIndex, seed);
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
