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
 * Resolve the effective voices for a line, considering section-level defaults
 * Priority: line.voices > sectionVoices > [] (all)
 * @param {Object} line - Line object with optional voices array
 * @param {string[]} [sectionVoices] - Default voices from the section
 * @returns {string[]}
 */
export function resolveLineVoices(line, sectionVoices = []) {
  if (line.voices && line.voices.length > 0) return line.voices;
  if (sectionVoices.length > 0) return sectionVoices;
  return [];
}

/**
 * Canonical voice order for stacked underlines (top-to-bottom visual).
 * Index 0 = closest to the text baseline; higher indices = lower on screen.
 */
export const CANONICAL_VOICE_ORDER = ['soprano', 'contralto', 'tenor', 'bass'];

/**
 * Build stacked underline spans for a range slice.
 * Filters out invalid IDs; renders in CANONICAL_VOICE_ORDER (stable).
 * Returns empty string if no valid voices.
 * @param {string[]} voices
 * @returns {string} HTML fragment
 */
export function buildVoiceUnderlines(voices) {
  if (!voices || voices.length === 0) return '';
  const valid = CANONICAL_VOICE_ORDER.filter((v) => voices.includes(v));
  if (valid.length === 0) return '';
  return valid.map((v) => `<span class="voice-underline voice-underline--${v}"></span>`).join('');
}

/**
 * Build highlighted HTML for a line of text with sub-line voice ranges.
 * Ranges that fall outside text length are ignored; caller should validate first.
 * Returns escaped text wrapped in spans per slice (range or gap).
 * @param {string} text
 * @param {Array<{start:number,end:number,voices:string[]}>} voiceRanges
 * @returns {string} HTML
 */
export function buildHighlightedHTML(text, voiceRanges) {
  if (!voiceRanges || voiceRanges.length === 0) return escapeHtml(text);

  const sorted = [...voiceRanges].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;

  for (const range of sorted) {
    if (cursor < range.start) {
      result += escapeHtml(text.slice(cursor, range.start));
    }
    const rangeText = text.slice(range.start, range.end);
    const underlines = buildVoiceUnderlines(range.voices || []);
    if (underlines) {
      result += `<span class="voice-range has-voice-ranges">${escapeHtml(rangeText)}${underlines}</span>`;
    } else {
      result += escapeHtml(rangeText);
    }
    cursor = range.end;
  }

  if (cursor < text.length) {
    result += escapeHtml(text.slice(cursor));
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
