import { groupsForVoice } from './voiceSystem.js';
import { transposeChord, transposeNote } from './lyricsRender.js';
import { displayChord, displayNote } from './chordNotation.js';
import {
  presetToSpeed,
  AUTOSCROLL_SPEED_MIN,
  AUTOSCROLL_SPEED_MAX,
  getAutoscrollSpeed as readBaseSpeed,
} from './autoscroll.js';
import { normalizeSectionType, SECTION_TYPE_LABELS } from './sectionTypes.js';

// Duración por línea en los extremos de velocidad: lento = 9s, rápido = 2.5s.
const SECONDS_PER_LINE_SLOW = 9;
const SECONDS_PER_LINE_FAST = 2.5;

/**
 * Mapea velocidad continua → segundos por línea. Interpolación lineal:
 * AUTOSCROLL_SPEED_MIN → SECONDS_PER_LINE_SLOW (9s), AUTOSCROLL_SPEED_MAX →
 * SECONDS_PER_LINE_FAST (2.5s). A más velocidad, menos segundos por línea.
 * @param {number} speed
 * @returns {number} segundos
 */
export function speedToSecondsPerLine(speed) {
  const clamped = Math.max(AUTOSCROLL_SPEED_MIN, Math.min(AUTOSCROLL_SPEED_MAX, speed));
  const normalized =
    (clamped - AUTOSCROLL_SPEED_MIN) / (AUTOSCROLL_SPEED_MAX - AUTOSCROLL_SPEED_MIN);
  return SECONDS_PER_LINE_SLOW - normalized * (SECONDS_PER_LINE_SLOW - SECONDS_PER_LINE_FAST);
}

/**
 * Proyecta `song.sections` (v3, ya upgraded) a una lista plana de líneas para
 * el teleprompter/vista inmersiva. Salta líneas `annotation`; las `spoken` se
 * conservan pero sin nota. `note` = primera nota no nula de la voz activa en
 * esa línea, transpuesta y en la notación pedida. `i` es un índice
 * incremental estable (igual al índice del array resultante) que replica la
 * proyección canónica del back (`api/_lib/align.js` projectCanonicalLines)
 * para poder mapear timings de alignment por posición.
 * @param {object} song
 * @param {{ getActiveVoice?: () => string|null,
 *           getTranspose?: () => {semitones:number, useFlats:boolean},
 *           getNotation?: () => 'anglo'|'latin',
 *           songId?: string }} [ctx]
 * @returns {Array<{i:number, sectionType:string, sectionLabel:string, text:string,
 *           chords:string[], chordsRaw:Array<{pos:number,ch:string}>, groups:Array,
 *           note:string|null, noteRaw:string|null, spoken:boolean, seconds:number}>}
 */
export function projectLines(song, ctx = {}) {
  const activeVoiceId = typeof ctx.getActiveVoice === 'function' ? ctx.getActiveVoice() : null;
  const { semitones = 0, useFlats = false } =
    (typeof ctx.getTranspose === 'function' ? ctx.getTranspose() : null) || {};
  const notation = typeof ctx.getNotation === 'function' ? ctx.getNotation() : 'anglo';
  const baseSpeed = readBaseSpeed(ctx.songId ?? song?.id);
  const speedRange = { min: AUTOSCROLL_SPEED_MIN, max: AUTOSCROLL_SPEED_MAX };

  const lines = [];
  for (const section of song?.sections || []) {
    const sectionType = normalizeSectionType(section.type);
    const sectionLabel = section.label || SECTION_TYPE_LABELS[sectionType];
    const presetSpeed = presetToSpeed(section.speedPreset, speedRange);
    const seconds = speedToSecondsPerLine(presetSpeed ?? baseSpeed);

    for (const line of section.lines || []) {
      if (line.annotation) continue;
      const spoken = !!line.spoken;
      const text = line.text || '';
      // chordsRaw: copia ordenada SIN transponer ni formatear — la usan los
      // builders de lyricsRender.js (T6, paridad de capas), que transponen y
      // formatean por su cuenta a partir de `opts`. `chords` (abajo) sigue
      // siendo la versión ya lista para el chip compacto del stage.
      const chordsRaw = [...(line.chords || [])].sort((a, b) => (a.pos || 0) - (b.pos || 0));
      const chords = chordsRaw
        .map((c) => (semitones ? transposeChord(c.ch, semitones, useFlats) : c.ch))
        .map((ch) => displayChord(ch, notation));
      // groups: crudos (sin transponer), para que buildTonoLineHTML/buildMixedLineHTML
      // pinten TODAS las notas por sílaba de la voz activa, no solo la primera.
      const groups = line.groups || [];

      let note = null;
      let noteRaw = null; // anglo, ya transpuesta (sin displayNote) — la usa el afinador embebido (F3)
      if (!spoken && activeVoiceId) {
        const withNote = groupsForVoice(line, activeVoiceId).find(
          (g) => g.note !== null && g.note !== undefined && g.note !== '',
        );
        if (withNote) {
          noteRaw = semitones ? transposeNote(withNote.note, semitones, useFlats) : withNote.note;
          note = displayNote(noteRaw, notation);
        }
      }

      lines.push({
        i: lines.length,
        sectionType,
        sectionLabel,
        text,
        chords,
        chordsRaw,
        groups,
        note,
        noteRaw,
        spoken,
        seconds,
      });
    }
  }
  return lines;
}
