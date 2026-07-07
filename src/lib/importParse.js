/**
 * Importa texto pegado → bloques de sección. Soporta el formato nativo
 * ([Verso 1]/[Coro] + acordes inline [Am]) y el estándar ChordPro (directivas
 * {title:}/{key:}/{start_of_verse}/etc.) más el formato "acordes en línea
 * aparte" (línea de solo acordes seguida de la línea de letra, alineados por
 * columna). También exporta de vuelta a ChordPro (songToChordPro).
 */
import { canonicalToChordProKey } from './musicKeys.js';

// Gramática de acorde: raíz + calidad/extensión opcional (repetible para
// combos como m7b5) + bajo opcional tras barra. Cubre maj7, m7b5, sus4, add9,
// dim7, aug, y slash chords (Am/E). Antes solo aceptaba UNA calidad + UN
// dígito, por eso Dm7b5/Cmaj7 no hacían round-trip (ver tests).
const CHORD_ROOT = '[A-G][#b]?';
const CHORD_BODY = '(?:(?:maj|min|dim|aug|sus|add|m)?[0-9]{0,2}(?:[#b][0-9]{1,2})?){0,3}(?:/[A-G][#b]?)?';
const CHORD_FULL_RE = new RegExp(`^${CHORD_ROOT}${CHORD_BODY}$`);
const INLINE_CHORD_RE = new RegExp(`\\[(${CHORD_ROOT}${CHORD_BODY})\\]`, 'g');

/** Directivas ChordPro reconocidas: forma corta y larga → acción. */
const META_DIRECTIVES = {
  title: 'title',
  t: 'title',
  artist: 'artist',
  subtitle: 'artist',
  st: 'artist',
  key: 'key',
  k: 'key',
  capo: 'capo',
};
const COMMENT_DIRECTIVES = new Set(['comment', 'c']);
const SECTION_STARTERS = {
  start_of_verse: 'verse',
  sov: 'verse',
  start_of_chorus: 'chorus',
  soc: 'chorus',
  start_of_bridge: 'bridge',
  sob: 'bridge',
};
const SECTION_ENDERS = new Set([
  'end_of_verse',
  'eov',
  'end_of_chorus',
  'eoc',
  'end_of_bridge',
  'eob',
]);
const SECTION_DEFAULT_LABEL = { verse: 'Verso', chorus: 'Coro', bridge: 'Puente' };

const DIRECTIVE_RE = /^\{\s*([a-zA-Z_]+)\s*(?::\s*(.*?)\s*)?\}$/;

function newLine(text, chords, annotation) {
  return {
    id: `line-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    groups: [],
    chords: chords || [],
    annotation: !!annotation,
  };
}

function newBlock(type, label, counter) {
  return {
    id: `section-imp-${counter}-${Date.now()}`,
    type,
    label,
    lines: [],
  };
}

/** Tokeniza una línea preservando la columna (índice de carácter) de cada token. */
function tokenizeWithColumns(line) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line)) !== null) tokens.push({ text: m[0], col: m.index });
  return tokens;
}

/**
 * Heurística conservadora de "línea de acordes en línea aparte": >50% de los
 * tokens de la línea parsean como acorde.
 */
function isChordOnlyLine(tokens) {
  if (tokens.length === 0) return false;
  const chordCount = tokens.filter((t) => CHORD_FULL_RE.test(t.text)).length;
  return chordCount / tokens.length > 0.5;
}

/**
 * @param {string} text
 * @returns {Array<object> & { meta: object }} bloques de sección; `meta`
 *   (no enumerable-safe, propiedad extra sobre el array) trae title/artist/
 *   key/capo si el texto traía directivas ChordPro.
 */
export function parseImportText(text) {
  const blocks = [];
  const meta = {};
  const rawLines = text.split('\n');
  let current = null;
  let sectionCounter = 0;

  const closeCurrent = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const directiveMatch = rawLine.trim().match(DIRECTIVE_RE);

    if (directiveMatch) {
      const name = directiveMatch[1].toLowerCase();
      const value = directiveMatch[2] ?? '';

      if (META_DIRECTIVES[name]) {
        const key = META_DIRECTIVES[name];
        if (key === 'capo') {
          const n = Number.parseInt(value, 10);
          if (!Number.isNaN(n)) meta.capo = n;
        } else if (value !== '') {
          meta[key] = value;
        }
        continue;
      }
      if (COMMENT_DIRECTIVES.has(name)) {
        if (!current) current = newBlock('verse', `Verso ${sectionCounter + 1}`, sectionCounter++);
        current.lines.push(newLine(value, [], true));
        continue;
      }
      if (SECTION_STARTERS[name]) {
        closeCurrent();
        const type = SECTION_STARTERS[name];
        const label = value || `${SECTION_DEFAULT_LABEL[type]} ${sectionCounter + 1}`;
        current = newBlock(type, label, sectionCounter++);
        continue;
      }
      if (SECTION_ENDERS.has(name)) {
        closeCurrent();
        continue;
      }
      // Directiva desconocida: se ignora (no se agrega como texto/sección).
      continue;
    }

    const sectionMatch = rawLine.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      closeCurrent();
      const label = sectionMatch[1];
      current = newBlock(guessType(label), label, sectionCounter++);
      continue;
    }

    if (rawLine.trim() === '') {
      if (current && current.lines.length > 0) closeCurrent();
      continue;
    }

    // Candidato a "línea de acordes en línea aparte": si la línea siguiente
    // existe y tiene letra (no es directiva/sección/vacía), se fusiona.
    const tokens = tokenizeWithColumns(rawLine);
    const nextRaw = rawLines[i + 1];
    const nextIsLyric =
      typeof nextRaw === 'string' &&
      nextRaw.trim() !== '' &&
      !nextRaw.match(/^\[(.+)\]$/) &&
      !nextRaw.trim().match(DIRECTIVE_RE);
    if (isChordOnlyLine(tokens) && nextIsLyric) {
      const lyricText = nextRaw;
      const chords = tokens
        .filter((t) => CHORD_FULL_RE.test(t.text))
        .map((t) => ({ ch: t.text, pos: Math.min(t.col, lyricText.length) }));
      if (!current) current = newBlock('verse', `Verso ${sectionCounter + 1}`, sectionCounter++);
      current.lines.push(newLine(lyricText, chords, false));
      i += 1; // consume también la línea de letra
      continue;
    }

    if (!current) current = newBlock('verse', `Verso ${sectionCounter + 1}`, sectionCounter++);
    const { text: cleanText, chords } = parseLineChords(rawLine);
    current.lines.push(newLine(cleanText, chords, false));
  }
  closeCurrent();
  blocks.meta = meta;
  return blocks;
}

/** Parse inline chords [Am]text [F]text → { text, chords }. */
export function parseLineChords(lineText) {
  const chords = [];
  let cleanText = '';
  INLINE_CHORD_RE.lastIndex = 0;
  let lastEnd = 0;
  let match;
  while ((match = INLINE_CHORD_RE.exec(lineText)) !== null) {
    cleanText += lineText.slice(lastEnd, match.index);
    chords.push({ ch: match[1], pos: cleanText.length });
    lastEnd = match.index + match[0].length;
  }
  cleanText += lineText.slice(lastEnd);
  return { text: cleanText, chords: chords.length > 0 ? chords : undefined };
}

/** Etiqueta → tipo de sección. */
export function guessType(label) {
  const lower = label.toLowerCase();
  if (lower.includes('verso') || lower.includes('verse')) return 'verse';
  if (lower.includes('coro') || lower.includes('chorus')) return 'chorus';
  if (lower.includes('puente') || lower.includes('bridge')) return 'bridge';
  if (lower.includes('pre')) return 'prechorus';
  if (lower.includes('intro')) return 'intro';
  if (lower.includes('outro')) return 'outro';
  return 'verse';
}

const CHORDPRO_SECTION_DIRECTIVE = {
  verse: ['start_of_verse', 'end_of_verse'],
  chorus: ['start_of_chorus', 'end_of_chorus'],
  bridge: ['start_of_bridge', 'end_of_bridge'],
};

/** Reinserta chords ({pos, ch}) como [Acorde] inline en el texto de una línea. */
function lineToChordProText(line) {
  if (line.annotation) return `{comment: ${line.text}}`;
  const chords = Array.isArray(line.chords) ? [...line.chords].sort((a, b) => a.pos - b.pos) : [];
  if (chords.length === 0) return line.text;
  let out = '';
  let lastPos = 0;
  for (const c of chords) {
    out += line.text.slice(lastPos, c.pos) + `[${c.ch}]`;
    lastPos = c.pos;
  }
  out += line.text.slice(lastPos);
  return out;
}

/**
 * Exporta una canción (schema v2/v3, `sections` con `type/label/lines`) a
 * texto ChordPro. Metadata (title/artist/key/capo) siempre se exporta si
 * está presente; verse/chorus/bridge usan directivas start/end_of_*, el
 * resto de tipos ([Pre-Coro]/[Intro]/[Outro]) usa el header `[Label]` legacy
 * para conservar el round-trip de esos tipos.
 * @param {{title?, artist?, key?, cejilla?, sections?: Array}} song
 * @returns {string}
 */
export function songToChordPro(song) {
  const lines = [];
  if (song.title) lines.push(`{title: ${song.title}}`);
  if (song.artist) lines.push(`{artist: ${song.artist}}`);
  const chordProKey = song.key ? canonicalToChordProKey(song.key) || song.key : '';
  if (chordProKey) lines.push(`{key: ${chordProKey}}`);
  if (song.cejilla !== null && song.cejilla !== undefined && song.cejilla !== '') {
    lines.push(`{capo: ${song.cejilla}}`);
  }
  if (lines.length > 0) lines.push('');

  for (const section of song.sections || []) {
    const directive = CHORDPRO_SECTION_DIRECTIVE[section.type];
    if (directive) {
      const [start, end] = directive;
      lines.push(section.label ? `{${start}: ${section.label}}` : `{${start}}`);
      for (const line of section.lines || []) lines.push(lineToChordProText(line));
      lines.push(`{${end}}`);
    } else {
      lines.push(`[${section.label || section.type}]`);
      for (const line of section.lines || []) lines.push(lineToChordProText(line));
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}
