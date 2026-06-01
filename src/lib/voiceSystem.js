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
 * @returns {boolean} true si es notación científica válida (mismo formato que profiles.vocal_range).
 */
export function isValidNote(value) {
  return typeof value === 'string' && NOTE_RE.test(value);
}
