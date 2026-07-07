/**
 * chordNotation.js — Capa de display de notación latina/anglosajona para
 * símbolos de acorde. El modelo (base de datos, transposeChord, etc.) SIEMPRE
 * guarda/opera en notación anglosajona (C, D, E…); esta capa solo traduce la
 * RAÍZ y el BAJO al pintar, preservando accidentales y sufijos (m, m7, sus4…).
 */

const ROOT_TO_LATIN = {
  C: 'Do',
  D: 'Re',
  E: 'Mi',
  F: 'Fa',
  G: 'Sol',
  A: 'La',
  B: 'Si',
};

const ROOT_RE = /^([A-G])([#b]?)/;

/**
 * Parsea la raíz de un símbolo de acorde/nota anglosajón (letra + accidental
 * opcional) del resto del símbolo (sufijo de acorde, octava de nota, bajo…).
 * Entradas irreconocibles → null. Usado por `toLatin` y por `transposeChord`
 * (lyricsRender.js) para no duplicar la regex de raíz.
 * @param {string} sym
 * @returns {{ root: string, accidental: string, rest: string } | null}
 */
export function parseChordRoot(sym) {
  const str = String(sym || '');
  const m = ROOT_RE.exec(str);
  if (!m) return null;
  return { root: m[1], accidental: m[2], rest: str.slice(m[0].length) };
}

/**
 * Traduce la raíz (y el bajo tras `/`, si existe) de un símbolo de acorde
 * anglosajón a notación latina, preservando accidentales y sufijos.
 * Entradas irreconocibles pasan intactas.
 * @param {string} ch
 * @returns {string}
 */
export function toLatin(ch) {
  const str = String(ch || '');
  if (!str) return str;
  const slashIdx = str.indexOf('/');
  const rootPart = slashIdx === -1 ? str : str.slice(0, slashIdx);
  const bassPart = slashIdx === -1 ? null : str.slice(slashIdx + 1);

  const translateRoot = (part) => {
    const parsed = parseChordRoot(part);
    if (!parsed) return part;
    const latin = ROOT_TO_LATIN[parsed.root];
    if (!latin) return part;
    return latin + parsed.accidental + parsed.rest;
  };

  const latinRoot = translateRoot(rootPart);
  if (bassPart === null) return latinRoot;
  return `${latinRoot}/${translateRoot(bassPart)}`;
}

const NOTE_RE = /^([A-G])([#b]?)(-?\d+)$/;

/**
 * Traduce una nota en notación científica ('G4', 'D#4') a su nombre en la
 * notación solicitada, preservando accidental y octava ('G4'→'Sol4' en
 * latin). La octava se mantiene siempre — información útil para coristas.
 * Entrada irreconocible o notation !== 'latin' pasa intacta.
 * @param {string} note
 * @param {'anglo'|'latin'} notation
 * @returns {string}
 */
export function displayNote(note, notation) {
  const str = String(note ?? '');
  if (notation !== 'latin') return str;
  const m = NOTE_RE.exec(str);
  if (!m) return str;
  const latin = ROOT_TO_LATIN[m[1]];
  if (!latin) return str;
  return `${latin}${m[2]}${m[3]}`;
}

/**
 * Devuelve el símbolo de acorde en la notación solicitada. El valor de
 * `notation` fuera de 'latin'/'anglo' se trata como 'anglo' (passthrough).
 * @param {string} ch
 * @param {'anglo'|'latin'} notation
 * @returns {string}
 */
export function displayChord(ch, notation) {
  return notation === 'latin' ? toLatin(ch) : String(ch || '');
}

const CHORD_NOTATION_KEY = 'hkn-chord-notation';
const DEFAULT_NOTATION = 'latin';

/**
 * Lee el setting global persistente de notación (localStorage). Default
 * 'latin' — el público hispano y el mockup mandan. Tolera localStorage roto.
 * @returns {'anglo'|'latin'}
 */
export function getChordNotation() {
  try {
    const stored = localStorage.getItem(CHORD_NOTATION_KEY);
    return stored === 'anglo' ? 'anglo' : DEFAULT_NOTATION;
  } catch {
    return DEFAULT_NOTATION;
  }
}

/**
 * Persiste el setting global de notación. Silencioso si localStorage falla.
 * @param {'anglo'|'latin'} value
 */
export function setChordNotation(value) {
  try {
    localStorage.setItem(CHORD_NOTATION_KEY, value === 'anglo' ? 'anglo' : 'latin');
  } catch {
    // localStorage puede fallar (Safari privado, cuota); el setting es best-effort.
  }
}
