/**
 * voiceSystem.js — Unified voice system
 *
 * Shared module with constants and utilities for the 4-voice system:
 * Soprano/Contralto (female) + Tenor/Bass (male).
 * Used by both the Block Editor and SongView Reader.
 */

/**
 * Voice groups organized by gender
 */
export const VOICE_GROUPS = [
  {
    gender: 'female',
    label: '♀ Femeninas',
    voices: [
      {
        id: 'soprano',
        label: 'Soprano',
        sublabel: 'Alta',
        cssColor: '--color-voice-soprano',
        cssBg: '--color-voice-soprano-bg',
      },
      {
        id: 'contralto',
        label: 'Contralto',
        sublabel: 'Baja',
        cssColor: '--color-voice-contralto',
        cssBg: '--color-voice-contralto-bg',
      },
    ],
  },
  {
    gender: 'male',
    label: '♂ Masculinas',
    voices: [
      {
        id: 'tenor',
        label: 'Tenor',
        sublabel: 'Alto',
        cssColor: '--color-voice-tenor',
        cssBg: '--color-voice-tenor-bg',
      },
      {
        id: 'bass',
        label: 'Bajo',
        sublabel: 'Bajo',
        cssColor: '--color-voice-bass',
        cssBg: '--color-voice-bass-bg',
      },
    ],
  },
];

/**
 * Flat array of all voice types with metadata
 */
export const VOICE_TYPES = VOICE_GROUPS.flatMap((group) =>
  group.voices.map((v) => ({
    ...v,
    gender: group.gender,
  })),
);

/**
 * Valid voice IDs
 */
export const VALID_VOICE_IDS = VOICE_TYPES.map((v) => v.id);

/**
 * Get the CSS custom property for a voice color
 * @param {string} voiceId
 * @returns {string} CSS var() value
 */
export function getVoiceColor(voiceId) {
  const voice = VOICE_TYPES.find((v) => v.id === voiceId);
  return voice ? `var(${voice.cssColor})` : 'inherit';
}

/**
 * Get the CSS custom property for a voice background highlight
 * @param {string} voiceId
 * @returns {string} CSS var() value
 */
export function getVoiceBgColor(voiceId) {
  const voice = VOICE_TYPES.find((v) => v.id === voiceId);
  return voice ? `var(${voice.cssBg})` : 'transparent';
}

/**
 * Get display label for a voice: "Soprano", "Contralto", "Tenor", "Bajo"
 * @param {string} voiceId
 * @returns {string}
 */
export function getVoiceLabel(voiceId) {
  const voice = VOICE_TYPES.find((v) => v.id === voiceId);
  return voice ? voice.label : voiceId;
}

/**
 * Get gender for a voice: "female" or "male"
 * @param {string} voiceId
 * @returns {string}
 */
export function getVoiceGender(voiceId) {
  const voice = VOICE_TYPES.find((v) => v.id === voiceId);
  return voice ? voice.gender : 'unknown';
}

/**
 * Canonical voice order for rendering (highest pitch first).
 * Index 0 = soprano (highest); index 3 = bass (lowest).
 */
export const CANONICAL_VOICE_ORDER = ['soprano', 'contralto', 'tenor', 'bass'];

/**
 * Validate and normalize voice ranges against a given text length.
 * - Trims `end` to textLength
 * - Drops ranges with empty voices or start >= end after trim
 * - Drops invalid voice IDs (filters to VALID_VOICE_IDS only)
 * - Sorts ascending by start
 * @param {Array} ranges
 * @param {number} textLength
 * @returns {Array<{start:number,end:number,voices:string[]}>}
 */
export function validateVoiceRanges(ranges, textLength) {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .map((r) => ({
      start: r.start | 0,
      end: Math.min(r.end | 0, textLength),
      voices: Array.isArray(r.voices) ? r.voices.filter((v) => VALID_VOICE_IDS.includes(v)) : [],
    }))
    .filter((r) => r.start < r.end && r.voices.length > 0)
    .sort((a, b) => a.start - b.start);
}

/**
 * Return voices from `voices` array re-ordered by CANONICAL_VOICE_ORDER,
 * with invalid IDs filtered out.
 * @param {string[]} voices
 * @returns {string[]}
 */
function canonicalize(voices) {
  if (!Array.isArray(voices)) return [];
  return CANONICAL_VOICE_ORDER.filter((v) => voices.includes(v));
}

/**
 * Build highlighted HTML for a line of text with sub-line voice ranges,
 * filtered by the currently active voice.
 *
 * Render rules:
 * - activeVoice === 'all': color every range with its FIRST canonical voice;
 *   plain gap text is bare (no span). Multi-voice ranges get a +N superscript
 *   badge colored with the SECOND canonical voice.
 * - activeVoice === a specific voice: ranges containing it are colored with
 *   that voice (full opacity). Ranges without it and plain gap text are
 *   wrapped in voice-text--dimmed. No badge in this mode.
 *
 * @param {string} text
 * @param {Array<{start:number,end:number,voices:string[]}>} voiceRanges
 * @param {string} [activeVoice='all']
 * @returns {string} HTML
 */
export function buildHighlightedHTML(text, voiceRanges, activeVoice = 'all') {
  const ranges = Array.isArray(voiceRanges) ? voiceRanges : [];

  if (ranges.length === 0) {
    if (activeVoice === 'all' || !text) return escapeHtml(text);
    return `<span class="voice-text voice-text--dimmed">${escapeHtml(text)}</span>`;
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;

  for (const range of sorted) {
    if (cursor < range.start) {
      const gap = text.slice(cursor, range.start);
      result +=
        activeVoice === 'all'
          ? escapeHtml(gap)
          : `<span class="voice-text voice-text--dimmed">${escapeHtml(gap)}</span>`;
    }
    const rangeText = text.slice(range.start, range.end);
    const canonical = canonicalize(range.voices || []);

    if (canonical.length === 0) {
      result += escapeHtml(rangeText);
    } else if (activeVoice === 'all') {
      const firstVoice = canonical[0];
      result += `<span class="voice-text voice-text--${firstVoice}">${escapeHtml(rangeText)}</span>`;
      if (canonical.length > 1) {
        const badgeVoice = canonical[1];
        const extras = canonical.length - 1;
        result += `<sup class="voice-badge-extra voice-badge-extra--${badgeVoice}">+${extras}</sup>`;
      }
    } else if (canonical.includes(activeVoice)) {
      result += `<span class="voice-text voice-text--${activeVoice}">${escapeHtml(rangeText)}</span>`;
    } else {
      result += `<span class="voice-text voice-text--dimmed">${escapeHtml(rangeText)}</span>`;
    }
    cursor = range.end;
  }

  if (cursor < text.length) {
    const tail = text.slice(cursor);
    result +=
      activeVoice === 'all'
        ? escapeHtml(tail)
        : `<span class="voice-text voice-text--dimmed">${escapeHtml(tail)}</span>`;
  }
  return result;
}

function escapeHtml(str) {
  if (str === '' || str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NOTE_RE = /^[A-G][#b]?[0-7]$/;

/**
 * @param {unknown} value
 * @returns {boolean} true si es notación científica válida (octavas 0-7, p.ej. B3, F#3, Eb5).
 */
export function isValidNote(value) {
  return typeof value === 'string' && NOTE_RE.test(value);
}

/**
 * Adaptador de lectura: convierte una canción v1 (4 voces fijas, voiceRanges)
 * en estructura v2 EN MEMORIA. No persiste. Idempotente para v2.
 * @param {object} song
 * @returns {object} canción v2
 */
export function upgradeLegacySong(song) {
  if (!song || song.schemaVersion === 2) return song;

  const usedCategories = new Set();
  for (const section of song.sections || []) {
    for (const line of section.lines || []) {
      for (const r of line.voiceRanges || []) {
        for (const v of r.voices || []) {
          if (VALID_VOICE_IDS.includes(v)) usedCategories.add(v);
        }
      }
    }
  }

  const voiceRoster = CANONICAL_VOICE_ORDER.filter((c) => usedCategories.has(c)).map(
    (category) => ({
      id: category, // una persona por categoría → id = category
      name: getVoiceLabel(category),
      category,
    }),
  );

  const sections = (song.sections || []).map((section) => ({
    ...section,
    lines: (section.lines || []).map((line) => {
      const ranges = line.voiceRanges || [];
      const syllables = ranges.map((r) => ({ start: r.start, end: r.end }));
      const voiceLines = {};
      ranges.forEach((r, i) => {
        for (const v of r.voices || []) {
          if (!VALID_VOICE_IDS.includes(v)) continue;
          if (!voiceLines[v]) voiceLines[v] = { sungSyllables: [], notes: [] };
          voiceLines[v].sungSyllables.push(i);
          voiceLines[v].notes.push(null);
        }
      });
      return { ...line, syllables, voiceLines };
    }),
  }));

  return { ...song, schemaVersion: 2, voiceRoster, sections };
}

/**
 * Valida una canción v2. Lanza Error con mensaje claro al primer problema.
 * No muta. `notes` admite null (sílaba cantada sin nota asignada aún).
 * @param {object} song
 * @returns {true}
 */
export function validateSongV2(song) {
  if (!song || song.schemaVersion !== 2) throw new Error('schemaVersion debe ser 2');

  const roster = song.voiceRoster || [];
  const ids = new Set();
  for (const v of roster) {
    if (!CANONICAL_VOICE_ORDER.includes(v.category)) {
      throw new Error(`category inválida en roster: ${v.category}`);
    }
    if (ids.has(v.id)) throw new Error(`id de roster duplicado: ${v.id}`);
    ids.add(v.id);
    if (v.referenceKey !== null && v.referenceKey !== undefined && !isValidNote(v.referenceKey)) {
      throw new Error(`referenceKey (nota) inválida: ${v.referenceKey}`);
    }
  }

  for (const section of song.sections || []) {
    for (const line of section.lines || []) {
      const text = line.text || '';
      const syllables = line.syllables || [];
      let prevEnd = 0;
      for (const s of syllables) {
        if (s.start < prevEnd) throw new Error('syllables solapadas (overlap)');
        // start === end permitido SOLO como extensor de melisma (texto vacío).
        if (s.start < 0 || s.end > text.length || s.start > s.end) {
          throw new Error('syllable fuera de rango');
        }
        prevEnd = s.end;
      }
      const vl = line.voiceLines || {};
      for (const [rosterId, data] of Object.entries(vl)) {
        if (!ids.has(rosterId)) {
          throw new Error(`voiceLines referencia roster inexistente: ${rosterId}`);
        }
        const sung = data.sungSyllables || [];
        const notes = data.notes || [];
        if (sung.length !== notes.length) {
          throw new Error('sungSyllables y notes con length distinto (no alineados)');
        }
        for (const idx of sung) {
          if (idx < 0 || idx >= syllables.length) throw new Error('sungSyllables fuera de índice');
        }
        for (const n of notes) {
          if (n !== null && n !== undefined && !isValidNote(n)) {
            throw new Error(`nota inválida: ${n}`);
          }
        }
      }
    }
  }
  return true;
}

/**
 * Para el modo Tono/persona: devuelve, por sílaba de la línea, el texto, la
 * nota de la voz activa (o null) y si esa voz la canta.
 * @param {object} line
 * @param {string} rosterId
 * @returns {Array<{text:string, note:string|null, sung:boolean}>}
 */
export function resolveSyllableNotes(line, rosterId) {
  const text = line?.text || '';
  const syllables = line?.syllables || [];
  const vl = line?.voiceLines?.[rosterId];
  const noteBySyll = new Map();
  if (vl) {
    (vl.sungSyllables || []).forEach((sIdx, i) => {
      noteBySyll.set(sIdx, vl.notes?.[i] ?? null);
    });
  }
  return syllables.map((s, idx) => ({
    text: text.slice(s.start, s.end),
    note: noteBySyll.has(idx) ? noteBySyll.get(idx) : null,
    sung: noteBySyll.has(idx),
  }));
}

/**
 * @param {object} song @param {string} category
 * @returns {Array} entradas del roster de esa categoría (en orden original).
 */
export function rosterByCategory(song, category) {
  return (song?.voiceRoster || []).filter((v) => v.category === category);
}

/**
 * Tono de referencia de una voz: su referenceKey explícito, o la primera nota
 * no nula que canta en la canción, o null.
 * @param {object} song @param {string} rosterId
 * @returns {string|null}
 */
export function deriveReferenceKey(song, rosterId) {
  const voice = (song?.voiceRoster || []).find((v) => v.id === rosterId);
  if (voice?.referenceKey) return voice.referenceKey;
  for (const section of song?.sections || []) {
    for (const line of section.lines || []) {
      const notes = line.voiceLines?.[rosterId]?.notes || [];
      for (const n of notes) {
        if (n !== null && n !== undefined) return n;
      }
    }
  }
  return null;
}
