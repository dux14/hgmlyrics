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
      { id: 'soprano', label: 'Soprano', sublabel: 'Alta', cssColor: '--color-voice-soprano', cssBg: '--color-voice-soprano-bg' },
      { id: 'contralto', label: 'Contralto', sublabel: 'Baja', cssColor: '--color-voice-contralto', cssBg: '--color-voice-contralto-bg' },
    ],
  },
  {
    gender: 'male',
    label: '♂ Masculinas',
    voices: [
      { id: 'tenor', label: 'Tenor', sublabel: 'Alto', cssColor: '--color-voice-tenor', cssBg: '--color-voice-tenor-bg' },
      { id: 'bass', label: 'Bajo', sublabel: 'Bajo', cssColor: '--color-voice-bass', cssBg: '--color-voice-bass-bg' },
    ],
  },
];

/**
 * Flat array of all voice types with metadata
 */
export const VOICE_TYPES = VOICE_GROUPS.flatMap(group =>
  group.voices.map(v => ({
    ...v,
    gender: group.gender,
  }))
);

/**
 * Valid voice IDs
 */
export const VALID_VOICE_IDS = VOICE_TYPES.map(v => v.id);

/**
 * Get the CSS custom property for a voice color
 * @param {string} voiceId
 * @returns {string} CSS var() value
 */
export function getVoiceColor(voiceId) {
  const voice = VOICE_TYPES.find(v => v.id === voiceId);
  return voice ? `var(${voice.cssColor})` : 'inherit';
}

/**
 * Get the CSS custom property for a voice background highlight
 * @param {string} voiceId
 * @returns {string} CSS var() value
 */
export function getVoiceBgColor(voiceId) {
  const voice = VOICE_TYPES.find(v => v.id === voiceId);
  return voice ? `var(${voice.cssBg})` : 'transparent';
}

/**
 * Get display label for a voice: "Soprano", "Contralto", "Tenor", "Bajo"
 * @param {string} voiceId
 * @returns {string}
 */
export function getVoiceLabel(voiceId) {
  const voice = VOICE_TYPES.find(v => v.id === voiceId);
  return voice ? voice.label : voiceId;
}

/**
 * Get gender for a voice: "female" or "male"
 * @param {string} voiceId
 * @returns {string}
 */
export function getVoiceGender(voiceId) {
  const voice = VOICE_TYPES.find(v => v.id === voiceId);
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
 * Build highlighted HTML with <span> colored for word-level voice assignments.
 * 
 * @param {string} text - The line text
 * @param {Array} [voiceRanges] - Array of { start, end, voices } for word-level overrides
 * @param {string[]} [defaultVoices] - Default voices for the whole line
 * @returns {string} HTML string with colored spans
 */
export function buildHighlightedHTML(text, voiceRanges = [], defaultVoices = []) {
  if (!voiceRanges || voiceRanges.length === 0) {
    // No word-level overrides — return text with line-level color
    if (defaultVoices.length === 1) {
      return `<span style="color: ${getVoiceColor(defaultVoices[0])}">${escapeHtml(text)}</span>`;
    }
    if (defaultVoices.length > 1) {
      // Multi-voice: use first voice color with a subtle indicator
      return `<span style="color: ${getVoiceColor(defaultVoices[0])}">${escapeHtml(text)}</span>`;
    }
    return escapeHtml(text);
  }

  // Sort ranges by start position
  const sorted = [...voiceRanges].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;

  for (const range of sorted) {
    // Text before this range — default voice color
    if (cursor < range.start) {
      const beforeText = text.slice(cursor, range.start);
      if (defaultVoices.length === 1) {
        result += `<span style="color: ${getVoiceColor(defaultVoices[0])}">${escapeHtml(beforeText)}</span>`;
      } else {
        result += escapeHtml(beforeText);
      }
    }

    // The range itself
    const rangeText = text.slice(range.start, range.end);
    const rangeVoice = range.voices?.[0];
    if (rangeVoice) {
      result += `<span style="color: ${getVoiceColor(rangeVoice)}; background: ${getVoiceBgColor(rangeVoice)}; border-radius: 3px; padding: 0 2px;">${escapeHtml(rangeText)}</span>`;
    } else {
      result += escapeHtml(rangeText);
    }

    cursor = range.end;
  }

  // Remaining text after last range
  if (cursor < text.length) {
    const afterText = text.slice(cursor);
    if (defaultVoices.length === 1) {
      result += `<span style="color: ${getVoiceColor(defaultVoices[0])}">${escapeHtml(afterText)}</span>`;
    } else {
      result += escapeHtml(afterText);
    }
  }

  return result;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
