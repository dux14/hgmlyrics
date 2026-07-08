import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { createWakeLock } from '../lib/wakeLock.js';
import { requestStageFullscreen, exitStageFullscreen } from '../lib/fullscreen.js';
import { groupsForVoice, rosterByCategory, CANONICAL_VOICE_ORDER } from '../lib/voiceSystem.js';
import {
  transposeChord,
  transposeNote,
  buildLetraLineHTML,
  buildChordsLineHTML,
  buildTonoLineHTML,
  buildMixedLineHTML,
} from '../lib/lyricsRender.js';
import { displayChord, displayNote, setChordNotation } from '../lib/chordNotation.js';
import {
  presetToSpeed,
  AUTOSCROLL_SPEED_MIN,
  AUTOSCROLL_SPEED_MAX,
  getAutoscrollSpeed as readBaseSpeed,
  saveAutoscrollSpeed as saveBaseSpeed,
  speedToPercentLabel,
} from '../lib/autoscroll.js';
import { buildVoiceChipHTML } from '../lib/voiceChips.js';
import { normalizeSectionType, SECTION_TYPE_LABELS } from '../lib/sectionTypes.js';
import { createTunerStrip } from '../lib/tunerWidget.js';
import { noteToMidi } from '../lib/notes.js';
import { getLayers, setLayer, deriveViewMode } from '../lib/layerStore.js';
import { isFeatureEnabled } from '../lib/authStore.js';
import { openOptionsSheet } from './OptionsSheet.js';
import '../styles/stage.css';

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
  const normalized = (clamped - AUTOSCROLL_SPEED_MIN) / (AUTOSCROLL_SPEED_MAX - AUTOSCROLL_SPEED_MIN);
  return SECONDS_PER_LINE_SLOW - normalized * (SECONDS_PER_LINE_SLOW - SECONDS_PER_LINE_FAST);
}

/**
 * Réplica local del helper homónimo de SongView.js (T6, paridad de capas):
 * decide si el toggle #stage-layer-chords tiene sentido para la canción.
 * @param {object} song @returns {boolean}
 */
function songHasChords(song) {
  return (song?.sections || []).some((s) => s.lines?.some((l) => l.chords && l.chords.length > 0));
}

// ── Escala de fuente del teleprompter (controles A−/A+) ──
const FONT_SCALE_KEY = 'hkn-stage-font-scale';
const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.6;
const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_DEFAULT = 1;

function readFontScale() {
  try {
    const stored = localStorage.getItem(FONT_SCALE_KEY);
    if (stored) {
      const val = Number.parseFloat(stored);
      if (val >= FONT_SCALE_MIN && val <= FONT_SCALE_MAX) return val;
    }
  } catch {
    /* localStorage puede fallar */
  }
  return FONT_SCALE_DEFAULT;
}

function saveFontScale(scale) {
  try {
    localStorage.setItem(FONT_SCALE_KEY, scale.toString());
  } catch {
    /* localStorage puede fallar */
  }
}

// ── Tamaño auto-fit de la línea actual ──
const FONT_MIN_REM = 1.6;
const FONT_MAX_REM = 3.2;
const FONT_MIN_CHARS = 20; // líneas <= 20 chars: tamaño máximo
const FONT_MAX_CHARS = 80; // líneas >= 80 chars: tamaño mínimo

/**
 * Interpola el font-size BASE (sin escala del usuario) de la línea actual
 * según su longitud (clamp 1.6rem..3.2rem, más grande cuanto más corta).
 * El multiplier de FONT_SCALE_KEY se aplica encima, en `renderZone`.
 * @param {number} length
 * @returns {number} rem, sin unidad
 */
function computeBaseFontRem(length) {
  if (length <= FONT_MIN_CHARS) return FONT_MAX_REM;
  if (length >= FONT_MAX_CHARS) return FONT_MIN_REM;
  const t = (length - FONT_MIN_CHARS) / (FONT_MAX_CHARS - FONT_MIN_CHARS);
  return FONT_MAX_REM - t * (FONT_MAX_REM - FONT_MIN_REM);
}

/**
 * Proyecta `song.sections` (v3, ya upgraded) a una lista plana de líneas para
 * el teleprompter. Salta líneas `annotation`; las `spoken` se conservan pero
 * sin nota. `note` = primera nota no nula de la voz activa en esa línea,
 * transpuesta y en la notación pedida.
 * @param {object} song
 * @param {{ getActiveVoice?: () => string|null,
 *           getTranspose?: () => {semitones:number, useFlats:boolean},
 *           getNotation?: () => 'anglo'|'latin',
 *           songId?: string }} [ctx]
 * @returns {Array<{sectionType:string, sectionLabel:string, text:string,
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

      lines.push({ sectionType, sectionLabel, text, chords, chordsRaw, groups, note, noteRaw, spoken, seconds });
    }
  }
  return lines;
}

const HINT_DURATION_MS = 4000;
const FEEDBACK_DURATION_MS = 1000;
const CONTROLS_HIDE_MS = 3000;
const SWIPE_THRESHOLD_PX = 40;
const GESTURE_SPEED_STEP = 0.1;

let session = null; // { songViewEl, overlay, els, song, ctx, lines, index, speed, songId, activeVoiceId, fontScale, paused, timer, hintTimer, feedbackTimer, hideControlsTimer, gesture, wl, handlers } | null

/**
 * @param {{ hasChords?: boolean, tonoAvailable?: boolean }} [opts]
 */
function buildOverlay(opts = {}) {
  const { hasChords = false, tonoAvailable = false } = opts;
  const overlay = document.createElement('div');
  overlay.className = 'stage-v2';
  overlay.innerHTML = `
    <div class="stage-v2__top">
      <span class="stage-v2__section-label" id="stage-v2-section"></span>
      <div class="stage-v2__voice-chips" id="stage-v2-voice-chips"></div>
      <span class="stage-v2__wakelock" id="stage-v2-wakelock" hidden>${icon('sun', { size: 16 })}<span>Pantalla activa</span></span>
    </div>
    <div class="stage-v2__progress"><div class="stage-v2__progress-fill" id="stage-v2-progress-fill"></div></div>
    <div class="stage-v2__body" id="stage-v2-tap">
      <div class="stage-v2__line stage-v2__line--prev" id="stage-v2-prev-line"></div>
      <div class="stage-v2__current" id="stage-v2-current">
        <div class="stage-v2__chords" id="stage-v2-chords"></div>
        <div class="stage-v2__text" id="stage-v2-text"></div>
      </div>
      <div class="stage-v2__line stage-v2__line--next" id="stage-v2-next-line"></div>
      <p class="stage-v2__hint" id="stage-v2-hint">Toca para pausar el auto-scroll · desliza para velocidad</p>
      <p class="stage-v2__feedback" id="stage-v2-feedback" hidden></p>
    </div>
    <button class="stage-v2__autoscroll-fab" id="stage-autoscroll-fab" type="button" aria-label="Pausar avance automático">
      <span id="stage-autoscroll-fab-icon">${icon('pause', { size: 22 })}</span>
    </button>
    <div class="stage-v2__tuner-row" id="stage-v2-tuner-row" hidden></div>
    <div class="stage-v2__controls" id="stage-v2-controls">
      <div class="stage-v2__controls-group">
        ${hasChords ? `<button class="layer-toggle" id="stage-layer-chords" type="button" aria-pressed="false">Acordes</button>` : ''}
        ${tonoAvailable ? `<button class="layer-toggle" id="stage-layer-tono" type="button" aria-pressed="false">Tono</button>` : ''}
      </div>
      <div class="stage-v2__controls-group">
        <button class="stage-v2__btn" id="stage-v2-prev" type="button" aria-label="Línea anterior">${icon('chevron-left', { size: 22 })}</button>
        <button class="stage-v2__btn stage-v2__btn--exit" id="stage-exit" type="button" aria-label="Salir del modo escenario">${icon('close', { size: 22 })}</button>
        <button class="stage-v2__btn" id="stage-v2-next" type="button" aria-label="Siguiente línea">${icon('chevron-right', { size: 22 })}</button>
      </div>
      <div class="stage-v2__controls-group">
        <button class="stage-v2__btn" id="stage-open-options" type="button" aria-label="Opciones">${icon('sliders', { size: 18 })}</button>
      </div>
      <div class="stage-v2__controls-group stage-v2__controls-group--tuner" id="stage-v2-tuner-slot"></div>
    </div>`;
  return overlay;
}

/**
 * Chips compactos S·A·T·B del chrome superior: solo categorías presentes en
 * el roster (CANONICAL_VOICE_ORDER filtrado), igual convención de inicial que
 * el hero de SongView ('A' para contralto).
 * @param {object} song @param {string|null} activeCategory
 * @returns {string}
 */
function renderVoiceChips(song, activeCategory) {
  const categories = CANONICAL_VOICE_ORDER.filter((c) => rosterByCategory(song, c).length > 0);
  if (categories.length === 0) return '';
  return categories
    .map((c) => buildVoiceChipHTML(c, { active: c === activeCategory, prefix: 'stage-v2__voice-chip' }))
    .join('');
}

function renderChordsRow(entry) {
  const chips = [];
  if (entry.note) {
    chips.push(`<span class="stage-v2__chip stage-v2__chip--note">${escapeHtml(entry.note)}</span>`);
  }
  for (const ch of entry.chords) {
    chips.push(`<span class="stage-v2__chip">${escapeHtml(ch)}</span>`);
  }
  return chips.join('');
}

/**
 * Renderiza la línea actual con el MISMO pipeline de builders que SongView
 * (lyricsRender.js), según la capa activa (layerStore, T6 — paridad con la
 * vista normal). El chip compacto nota/acordes (`renderChordsRow`) sigue
 * vivo aparte, sin depender de las capas (lo usa el afinador embebido).
 * @param {object} s sesión @param {object} cur línea proyectada actual
 * @returns {string} HTML
 */
function buildCurrentLineHTML(s, cur) {
  if (cur.spoken || cur.text.trim() === '') return buildLetraLineHTML(cur.text);

  // FIX finding 1 (CRITICAL): `getLayers()` es la preferencia GLOBAL del
  // dispositivo — sin intersectarla con lo que ESTA canción soporta
  // (s.hasChords/s.tonoAvailable, calculados en enterStage), una capa
  // encendida en otra canción con acordes sangraba acá también, sin control
  // para apagarla (el toggle #stage-layer-chords ni se pinta si !hasChords).
  const rawLayers = getLayers();
  const viewMode = deriveViewMode({
    chords: rawLayers.chords && s.hasChords,
    tono: rawLayers.tono && s.tonoAvailable,
  });
  const { semitones = 0, useFlats = false } =
    (typeof s.ctx.getTranspose === 'function' ? s.ctx.getTranspose() : null) || {};
  const notation = typeof s.ctx.getNotation === 'function' ? s.ctx.getNotation() : 'anglo';
  const category = (s.song.voiceRoster || []).find((v) => v.id === s.activeVoiceId)?.category ?? null;
  const colorClass = category ? `voice-text--${category}` : '';
  const line = { text: cur.text, groups: cur.groups };

  if (viewMode === 'mixed') {
    return buildMixedLineHTML(line, cur.chordsRaw, s.activeVoiceId, colorClass, {
      transposeSemitones: semitones,
      useFlats,
      notation,
    });
  }
  if (viewMode === 'tono') {
    if (!s.activeVoiceId) return buildLetraLineHTML(cur.text);
    return buildTonoLineHTML(line, s.activeVoiceId, colorClass, { notation });
  }
  if (viewMode === 'chords') {
    return buildChordsLineHTML(cur.text, cur.chordsRaw, { transposeSemitones: semitones, useFlats, notation });
  }
  return buildLetraLineHTML(cur.text);
}

/** Pinta las 3 zonas (previa/actual/siguiente) + label de sección + progreso. */
function renderZone(s) {
  const { lines, index, els } = s;
  const cur = lines[index];
  const prev = lines[index - 1] || null;
  const next = lines[index + 1] || null;

  els.prevLine.textContent = prev ? prev.text : '';
  els.nextLine.textContent = next ? next.text : '';

  els.currentText.innerHTML = buildCurrentLineHTML(s, cur);
  els.currentText.classList.toggle('stage-v2__text--spoken', cur.spoken);
  els.currentEl.style.fontSize = `${(computeBaseFontRem(cur.text.length) * s.fontScale).toFixed(2)}rem`;
  els.chords.innerHTML = renderChordsRow(cur);

  els.sectionLabel.textContent = cur.sectionLabel;
  els.sectionLabel.className = `stage-v2__section-label stage-v2__section-label--${cur.sectionType}`;

  const pct = lines.length > 1 ? (index / (lines.length - 1)) * 100 : 0;
  els.progressFill.style.height = `${pct}%`;

  els.prevBtn.disabled = index === 0;
  els.nextBtn.disabled = index === lines.length - 1;

  if (s.tunerStrip) {
    s.tunerStrip.setTargetNote(cur.noteRaw ? noteToMidi(cur.noteRaw) : null);
  }
}

/** Re-proyecta `s.lines` con la voz activa/velocidad vigentes, preservando el índice. */
function recomputeLines(s) {
  s.lines = projectLines(s.song, {
    getActiveVoice: () => s.activeVoiceId,
    getTranspose: s.ctx.getTranspose,
    getNotation: s.ctx.getNotation,
    songId: s.songId,
  });
  s.index = Math.max(0, Math.min(s.lines.length - 1, s.index));
}

/** Muestra `text` en el feedback flotante ~1s (velocidad ajustada por gesto). */
function showFeedback(s, text) {
  clearTimeout(s.feedbackTimer);
  s.els.feedback.textContent = text;
  s.els.feedback.hidden = false;
  s.feedbackTimer = setTimeout(() => {
    s.els.feedback.hidden = true;
  }, FEEDBACK_DURATION_MS);
}

/** Aplica una velocidad ya clampada: persiste, re-proyecta y reprograma el timer. */
function applySpeed(s, next) {
  s.speed = next;
  saveBaseSpeed(next, s.songId);
  recomputeLines(s);
  renderZone(s);
  scheduleAdvance(s);
}

/** Ajusta la velocidad de avance ±GESTURE_SPEED_STEP (gestos), con feedback flotante. */
function adjustSpeed(s, delta) {
  const next = Math.max(AUTOSCROLL_SPEED_MIN, Math.min(AUTOSCROLL_SPEED_MAX, s.speed + delta));
  if (next === s.speed) return; // ya en el límite, sin feedback
  applySpeed(s, next);
  showFeedback(s, `Velocidad ${speedToPercentLabel(next)}`);
}

/**
 * Ajusta la velocidad desde el grupo AUTO-SCROLL del sheet compartido (T6):
 * mismo paso/clamp que los gestos, sin el toast flotante (el sheet ya
 * muestra el valor en su propio label). Devuelve la etiqueta para que
 * OptionsSheet actualice `#osheet-autoscroll`.
 * @param {object} s @param {1|-1} dir @returns {string}
 */
function adjustSpeedFromSheet(s, dir) {
  const next = Math.max(AUTOSCROLL_SPEED_MIN, Math.min(AUTOSCROLL_SPEED_MAX, s.speed + dir * GESTURE_SPEED_STEP));
  if (next !== s.speed) applySpeed(s, next);
  return speedToPercentLabel(s.speed);
}

/**
 * Togglea una capa de lectura (Acordes/Tono) DENTRO del escenario. Estado
 * global compartido con la vista normal (layerStore) — togglear acá y salir
 * deja la vista normal en el mismo estado (paridad). Solo re-pinta la línea
 * actual; no reproyecta ni reinicia el motor de avance.
 * @param {object} s @param {'chords'|'tono'} name
 */
function toggleStageLayer(s, name) {
  const layers = getLayers();
  const next = !layers[name];
  setLayer(name, next);
  const btn = s.els[name === 'chords' ? 'layerChordsBtn' : 'layerTonoBtn'];
  btn?.setAttribute('aria-pressed', String(next));
  renderZone(s);
  showControls(s);
}

/** Cambia la voz activa DENTRO del escenario (chip S·A·T·B); sincroniza con SongView. */
function selectStageVoice(s, category) {
  const people = rosterByCategory(s.song, category);
  if (people.length === 0) return;
  s.activeVoiceId = people[0].id;
  recomputeLines(s);
  renderZone(s);
  s.els.voiceChips.querySelectorAll('[data-category]').forEach((chip) => {
    const isActive = chip.dataset.category === category;
    chip.classList.toggle('stage-v2__voice-chip--active', isActive);
    chip.setAttribute('aria-pressed', String(isActive));
  });
  if (typeof s.ctx.setActiveVoice === 'function') s.ctx.setActiveVoice(category, people[0].id);
}

/** Muestra los controles flotantes y reprograma su auto-ocultado a los 3s. */
function showControls(s) {
  clearTimeout(s.hideControlsTimer);
  s.els.controls.classList.remove('stage-v2__controls--hidden');
  s.hideControlsTimer = setTimeout(() => {
    s.els.controls.classList.add('stage-v2__controls--hidden');
  }, CONTROLS_HIDE_MS);
}

/** Programa el avance automático a la línea siguiente, según `seconds` de la línea actual. No-op en pausa. */
function scheduleAdvance(s) {
  clearTimeout(s.timer);
  if (s.paused) return;
  const cur = s.lines[s.index];
  const ms = Math.max(500, (cur?.seconds ?? SECONDS_PER_LINE_SLOW) * 1000);
  s.timer = setTimeout(() => goTo(s, s.index + 1), ms);
}

/** Navega a `index` (clampado), re-pinta y reprograma el timer. */
function goTo(s, index) {
  s.index = Math.max(0, Math.min(s.lines.length - 1, index));
  renderZone(s);
  scheduleAdvance(s);
}

function togglePause(s) {
  s.paused = !s.paused;
  s.els.overlay.classList.toggle('stage-v2--paused', s.paused);
  s.els.autoscrollFabIcon.innerHTML = icon(s.paused ? 'play' : 'pause', { size: 22 });
  s.els.autoscrollFab.setAttribute(
    'aria-label',
    s.paused ? 'Reanudar avance automático' : 'Pausar avance automático',
  );
  if (s.paused) clearTimeout(s.timer);
  else scheduleAdvance(s);
}

/**
 * Entra al modo escenario: proyecta `ctx.song` y monta el overlay teleprompter.
 * Idempotente; no-op si no hay canción o no hay líneas proyectables.
 * @param {HTMLElement} songViewEl elemento `.song-view` a cubrir (se marca, no se scrollea)
 * @param {{ song: object, getActiveVoice?: () => string|null,
 *           getTranspose?: () => {semitones:number, useFlats:boolean},
 *           getNotation?: () => 'anglo'|'latin',
 *           setActiveVoice?: (category: string, personId?: string) => void,
 *           pauseAutoscroll?: () => void, onExit?: () => void }} ctx contexto vivo desde SongView;
 *           setActiveVoice sincroniza el chip S·A·T·B del escenario con el selector de voz de SongView
 *           (personId elige la persona concreta cuando la categoría tiene 2+ voces);
 *           pauseAutoscroll detiene el motor de autoscroll clásico, que si no seguiría
 *           corriendo detrás del overlay; onExit (FIX finding 2) se llama al salir del
 *           escenario para que SongView resincronice su estado de capas con layerStore.
 */
export function enterStage(songViewEl, ctx = {}) {
  if (session || !songViewEl || !ctx.song) return; // idempotente

  if (typeof ctx.pauseAutoscroll === 'function') ctx.pauseAutoscroll();

  const songId = ctx.song.id;
  const activeVoiceId = typeof ctx.getActiveVoice === 'function' ? ctx.getActiveVoice() : null;
  const lines = projectLines(ctx.song, { ...ctx, getActiveVoice: () => activeVoiceId, songId });
  if (lines.length === 0) return; // nada que proyectar

  const hasChords = songHasChords(ctx.song);
  const tonoAvailable = isFeatureEnabled('voz_tono') && (ctx.song.voiceRoster || []).length > 0;

  songViewEl.classList.add('song-view--stage');
  document.body.classList.add('stage-active');

  const overlay = buildOverlay({ hasChords, tonoAvailable });
  document.body.appendChild(overlay);

  const layers = getLayers();
  const els = {
    overlay,
    sectionLabel: overlay.querySelector('#stage-v2-section'),
    voiceChips: overlay.querySelector('#stage-v2-voice-chips'),
    wakelock: overlay.querySelector('#stage-v2-wakelock'),
    tapArea: overlay.querySelector('#stage-v2-tap'),
    prevLine: overlay.querySelector('#stage-v2-prev-line'),
    currentEl: overlay.querySelector('#stage-v2-current'),
    chords: overlay.querySelector('#stage-v2-chords'),
    currentText: overlay.querySelector('#stage-v2-text'),
    nextLine: overlay.querySelector('#stage-v2-next-line'),
    hint: overlay.querySelector('#stage-v2-hint'),
    feedback: overlay.querySelector('#stage-v2-feedback'),
    progressFill: overlay.querySelector('#stage-v2-progress-fill'),
    tunerRow: overlay.querySelector('#stage-v2-tuner-row'),
    tunerSlot: overlay.querySelector('#stage-v2-tuner-slot'),
    controls: overlay.querySelector('#stage-v2-controls'),
    prevBtn: overlay.querySelector('#stage-v2-prev'),
    nextBtn: overlay.querySelector('#stage-v2-next'),
    exitBtn: overlay.querySelector('#stage-exit'),
    layerChordsBtn: overlay.querySelector('#stage-layer-chords'),
    layerTonoBtn: overlay.querySelector('#stage-layer-tono'),
    openOptionsBtn: overlay.querySelector('#stage-open-options'),
    autoscrollFab: overlay.querySelector('#stage-autoscroll-fab'),
    autoscrollFabIcon: overlay.querySelector('#stage-autoscroll-fab-icon'),
  };
  els.layerChordsBtn?.setAttribute('aria-pressed', String(layers.chords));
  els.layerTonoBtn?.setAttribute('aria-pressed', String(layers.tono));

  const wl = createWakeLock();
  session = {
    songViewEl,
    overlay,
    els,
    song: ctx.song,
    ctx,
    hasChords,
    tonoAvailable,
    lines,
    index: 0,
    speed: readBaseSpeed(songId),
    songId,
    activeVoiceId,
    fontScale: readFontScale(),
    paused: false,
    timer: null,
    hintTimer: null,
    feedbackTimer: null,
    hideControlsTimer: null,
    gesture: null,
    wl,
    tunerOn: false,
    tunerStrip: null,
  };

  const activeCategory = (ctx.song.voiceRoster || []).find((v) => v.id === activeVoiceId)?.category ?? null;
  els.voiceChips.innerHTML = renderVoiceChips(ctx.song, activeCategory);

  // F3: afinador embebido. La franja vive oculta en su propia fila hasta que
  // se activa el toggle; el toggle ES el gesto de usuario para el mic (nunca
  // auto-start al re-entrar al escenario — `tunerOn` nace en false en cada
  // `enterStage`, no se persiste en localStorage).
  const tunerStrip = createTunerStrip({
    getTargetNote: () => {
      const cur = session.lines[session.index];
      return cur?.noteRaw ? noteToMidi(cur.noteRaw) : null;
    },
  });
  els.tunerRow.appendChild(tunerStrip.el);
  session.tunerStrip = tunerStrip;

  const tunerToggleBtn = document.createElement('button');
  tunerToggleBtn.type = 'button';
  tunerToggleBtn.className = 'stage-v2__btn stage-v2__btn--tuner';
  tunerToggleBtn.setAttribute('aria-label', 'Activar afinador');
  tunerToggleBtn.setAttribute('aria-pressed', 'false');
  tunerToggleBtn.innerHTML = icon('mic', { size: 20 });
  els.tunerSlot.appendChild(tunerToggleBtn);

  const onTunerToggle = () => {
    session.tunerOn = !session.tunerOn;
    tunerToggleBtn.setAttribute('aria-pressed', String(session.tunerOn));
    els.tunerRow.hidden = !session.tunerOn;
    if (session.tunerOn) tunerStrip.start();
    else tunerStrip.stop();
    showControls(session);
  };
  tunerToggleBtn.addEventListener('click', onTunerToggle);

  wl.acquire();
  if (wl.supported) els.wakelock.hidden = false;

  renderZone(session);
  scheduleAdvance(session);
  session.hintTimer = setTimeout(() => els.hint.classList.add('stage-v2__hint--hidden'), HINT_DURATION_MS);
  showControls(session);

  // Tap en el área central (no en los controles ni chips): si los controles
  // están ocultos (auto-hide), el tap solo los despierta (patrón estándar de
  // players); si ya están visibles, pausa/reanuda además de reprogramar su
  // auto-ocultado. Un swipe real (onPointerUp) marca suppressClick para que
  // este click no pause encima.
  const onTap = (e) => {
    if (e.target.closest('.stage-v2__controls') || e.target.closest('.stage-v2__voice-chips')) return;
    if (session.suppressClick) {
      session.suppressClick = false;
      return;
    }
    const controlsHidden = els.controls.classList.contains('stage-v2__controls--hidden');
    showControls(session);
    if (controlsHidden) return; // solo despierta los controles, no pausa
    togglePause(session);
  };
  els.tapArea.addEventListener('click', onTap);

  // Gestos: swipe vertical = velocidad ±, swipe horizontal = línea sig/ant.
  // Por debajo del umbral de swipe (40px) en ambos ejes no es un gesto real
  // (zona muerta): se deja sin suprimir para que el click de arriba actúe
  // como un tap normal.
  const onPointerDown = (e) => {
    if (e.target.closest('.stage-v2__controls') || e.target.closest('.stage-v2__voice-chips')) return;
    session.gesture = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY };
  };
  const onPointerMove = (e) => {
    if (!session.gesture) return;
    session.gesture.lastX = e.clientX;
    session.gesture.lastY = e.clientY;
  };
  const onPointerUp = (e) => {
    const g = session.gesture;
    session.gesture = null;
    if (!g) return;
    const dx = (e.clientX ?? g.lastX) - g.startX;
    const dy = (e.clientY ?? g.lastY) - g.startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const isVerticalSwipe = ady > adx && ady >= SWIPE_THRESHOLD_PX;
    const isHorizontalSwipe = adx > ady && adx >= SWIPE_THRESHOLD_PX;
    if (!isVerticalSwipe && !isHorizontalSwipe) return; // sin umbral cruzado: lo maneja onTap
    session.suppressClick = true;
    showControls(session);
    if (isVerticalSwipe) {
      adjustSpeed(session, dy < 0 ? GESTURE_SPEED_STEP : -GESTURE_SPEED_STEP);
    } else {
      goTo(session, session.index + (dx < 0 ? 1 : -1));
    }
  };
  els.tapArea.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);

  const onPrev = () => {
    showControls(session);
    goTo(session, session.index - 1);
  };
  const onNext = () => {
    showControls(session);
    goTo(session, session.index + 1);
  };
  els.prevBtn.addEventListener('click', onPrev);
  els.nextBtn.addEventListener('click', onNext);
  els.exitBtn.addEventListener('click', () => exitStage());

  // Capas de lectura (T6): mismo estado global que la vista normal
  // (layerStore) — togglear acá y salir deja la vista normal en el mismo
  // estado. Solo re-pinta la línea actual, sin tocar el motor de avance.
  const onLayerChordsClick = () => toggleStageLayer(session, 'chords');
  const onLayerTonoClick = () => toggleStageLayer(session, 'tono');
  els.layerChordsBtn?.addEventListener('click', onLayerChordsClick);
  els.layerTonoBtn?.addEventListener('click', onLayerTonoClick);

  // Sheet de opciones compartido (T4/T6): mismo componente que la vista
  // normal. A−/A+ del stage viven en el grupo TAMAÑO; la velocidad de avance,
  // en AUTO-SCROLL. TONO (transposición) queda fuera — el stage no tiene un
  // setter de transposeSemitones propio, solo lee ctx.getTranspose().
  const onOpenOptions = () => {
    showControls(session);
    openOptionsSheet({
      song: session.song,
      // FIX finding 3: el stage no tiene onToggleVoice (no hay concepto de
      // "voz atenuada" acá) — showVoices: false oculta la sección para no
      // pintar switches que no hacen nada.
      showVoices: false,
      showTono: false,
      notation: typeof session.ctx.getNotation === 'function' ? session.ctx.getNotation() : 'anglo',
      fontLabel: session.fontScale.toFixed(2),
      autoscrollLabel: speedToPercentLabel(session.speed),
      onNotationChange: (value) => {
        setChordNotation(value);
        renderZone(session);
      },
      onFont: (dir) => {
        session.fontScale = Math.max(
          FONT_SCALE_MIN,
          Math.min(FONT_SCALE_MAX, session.fontScale + dir * FONT_SCALE_STEP),
        );
        saveFontScale(session.fontScale);
        renderZone(session);
        const of = document.querySelector('#osheet-font');
        if (of) of.textContent = session.fontScale.toFixed(2);
      },
      onAutoscroll: (dir) => adjustSpeedFromSheet(session, dir),
      // BUG Important (code-review T6): el hideControlsTimer de showControls
      // sigue corriendo mientras el sheet está abierto (>=3s lo oculta). Al
      // cerrar, sin este onClose los controles (salir/capas/opciones)
      // quedaban invisibles hasta el próximo tap. openOptionsSheet ya invoca
      // opts.onClose síncronamente dentro de close(), antes de la animación
      // de salida, así que re-armar el auto-hide acá es inmediato.
      onClose: () => showControls(session),
    });
  };
  els.openOptionsBtn.addEventListener('click', onOpenOptions);

  // FAB de auto-scroll (siempre presente, fuera del auto-hide de controles):
  // play/pause del motor de avance, mismo `togglePause` que el tap central.
  const onAutoscrollFabClick = () => togglePause(session);
  els.autoscrollFab.addEventListener('click', onAutoscrollFabClick);

  const onVoiceChipClick = (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    selectStageVoice(session, btn.dataset.category);
  };
  els.voiceChips.addEventListener('click', onVoiceChipClick);

  const onKey = (e) => {
    if (e.key === 'Escape') exitStage();
  };
  document.addEventListener('keydown', onKey);

  // Wake Lock + re-adquisicion al volver de background.
  const onVis = () => {
    if (document.visibilityState === 'visible') wl.acquire();
  };
  document.addEventListener('visibilitychange', onVis);

  // Navegar (atras del navegador / cambio de hash) sale del escenario.
  const onNav = () => exitStage();
  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);

  // Fullscreen nativo como mejora progresiva.
  requestStageFullscreen(document.documentElement);

  Object.assign(session, {
    onTap,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPrev,
    onNext,
    onLayerChordsClick,
    onLayerTonoClick,
    onOpenOptions,
    onAutoscrollFabClick,
    onVoiceChipClick,
    onKey,
    onVis,
    onNav,
    onTunerToggle,
    tunerToggleBtn,
  });
}

export function exitStage() {
  if (!session) return; // idempotente
  const {
    songViewEl,
    overlay,
    els,
    wl,
    ctx,
    timer,
    hintTimer,
    feedbackTimer,
    hideControlsTimer,
    onTap,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPrev,
    onNext,
    onLayerChordsClick,
    onLayerTonoClick,
    onOpenOptions,
    onAutoscrollFabClick,
    onVoiceChipClick,
    onKey,
    onVis,
    onNav,
    onTunerToggle,
    tunerToggleBtn,
    tunerStrip,
  } = session;

  clearTimeout(timer);
  clearTimeout(hintTimer);
  clearTimeout(feedbackTimer);
  clearTimeout(hideControlsTimer);

  els.tapArea.removeEventListener('click', onTap);
  els.tapArea.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  els.prevBtn.removeEventListener('click', onPrev);
  els.nextBtn.removeEventListener('click', onNext);
  els.layerChordsBtn?.removeEventListener('click', onLayerChordsClick);
  els.layerTonoBtn?.removeEventListener('click', onLayerTonoClick);
  els.openOptionsBtn.removeEventListener('click', onOpenOptions);
  els.autoscrollFab.removeEventListener('click', onAutoscrollFabClick);
  els.voiceChips.removeEventListener('click', onVoiceChipClick);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('hashchange', onNav);
  window.removeEventListener('popstate', onNav);
  tunerToggleBtn.removeEventListener('click', onTunerToggle);

  // Mic nunca queda abierto al salir del escenario, esté el toggle en on o off.
  tunerStrip.stop();

  wl.release();
  exitStageFullscreen();

  overlay.remove();
  songViewEl.classList.remove('song-view--stage');
  document.body.classList.remove('stage-active');

  session = null;

  // FIX finding 2: SongView resincroniza su closure (layers/viewMode/
  // aria-pressed/letra) desde layerStore acá — el toggle #stage-layer-chords/
  // tono adentro del escenario ya lo persistió, pero la vista normal no se
  // enteraba hasta el próximo render completo.
  ctx.onExit?.();
}
