import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { createWakeLock } from '../lib/wakeLock.js';
import { requestStageFullscreen, exitStageFullscreen } from '../lib/fullscreen.js';
import { groupsForVoice, rosterByCategory, CANONICAL_VOICE_ORDER, getVoiceLabel } from '../lib/voiceSystem.js';
import { transposeChord, transposeNote } from '../lib/lyricsRender.js';
import { displayChord, displayNote } from '../lib/chordNotation.js';
import { presetToSpeed } from '../lib/autoscroll.js';
import { normalizeSectionType, SECTION_TYPE_LABELS } from '../lib/sectionTypes.js';
import '../styles/stage.css';

// ── Velocidad: continua (px/frame, hkn-autoscroll-speed) → segundos por línea ──
const AUTOSCROLL_SPEED_KEY = 'hkn-autoscroll-speed';
const AUTOSCROLL_SPEED_MIN = 0.01;
const AUTOSCROLL_SPEED_MAX = 2.0;
const AUTOSCROLL_SPEED_DEFAULT = 0.5;
// Duración por línea en los extremos de velocidad: lento = 9s, rápido = 2.5s.
const SECONDS_PER_LINE_SLOW = 9;
const SECONDS_PER_LINE_FAST = 2.5;

/**
 * Lee la velocidad continua guardada por SongView (autoscroll clásico),
 * por canción o global. Best-effort: localStorage roto → default.
 * @param {string|undefined} songId
 * @returns {number} velocidad en [AUTOSCROLL_SPEED_MIN, AUTOSCROLL_SPEED_MAX]
 */
function readBaseSpeed(songId) {
  try {
    const perSong = songId && localStorage.getItem(`${AUTOSCROLL_SPEED_KEY}:${songId}`);
    const stored = perSong ?? localStorage.getItem(AUTOSCROLL_SPEED_KEY);
    if (stored) {
      const val = Number.parseFloat(stored);
      if (val >= AUTOSCROLL_SPEED_MIN && val <= AUTOSCROLL_SPEED_MAX) return val;
    }
  } catch {
    /* localStorage puede fallar (Safari privado, cuota) */
  }
  return AUTOSCROLL_SPEED_DEFAULT;
}

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
 * Persiste la velocidad ajustada por gesto en la misma clave que el
 * autoscroll clásico de SongView (por canción si hay songId, si no global).
 * @param {number} speed @param {string|undefined} songId
 */
function saveBaseSpeed(speed, songId) {
  try {
    const key = songId ? `${AUTOSCROLL_SPEED_KEY}:${songId}` : AUTOSCROLL_SPEED_KEY;
    localStorage.setItem(key, speed.toString());
  } catch {
    /* localStorage puede fallar (Safari privado, cuota) */
  }
}

/** @param {number} speed @returns {string} p.ej. "65%" */
function speedToPercentLabel(speed) {
  return `${Math.round(speed * 100)}%`;
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
 *           chords:string[], note:string|null, spoken:boolean, seconds:number}>}
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
      const chords = [...(line.chords || [])]
        .sort((a, b) => (a.pos || 0) - (b.pos || 0))
        .map((c) => (semitones ? transposeChord(c.ch, semitones, useFlats) : c.ch))
        .map((ch) => displayChord(ch, notation));

      let note = null;
      if (!spoken && activeVoiceId) {
        const withNote = groupsForVoice(line, activeVoiceId).find(
          (g) => g.note !== null && g.note !== undefined && g.note !== '',
        );
        if (withNote) {
          const raw = semitones ? transposeNote(withNote.note, semitones, useFlats) : withNote.note;
          note = displayNote(raw, notation);
        }
      }

      lines.push({ sectionType, sectionLabel, text, chords, note, spoken, seconds });
    }
  }
  return lines;
}

const HINT_DURATION_MS = 4000;
const FEEDBACK_DURATION_MS = 1000;
const CONTROLS_HIDE_MS = 3000;
const TAP_THRESHOLD_PX = 10;
const SWIPE_THRESHOLD_PX = 40;
const GESTURE_SPEED_STEP = 0.1;

let session = null; // { songViewEl, overlay, els, song, ctx, lines, index, speed, songId, activeVoiceId, fontScale, paused, timer, hintTimer, feedbackTimer, hideControlsTimer, gesture, wl, handlers } | null

function buildOverlay() {
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
    <div class="stage-v2__controls" id="stage-v2-controls">
      <div class="stage-v2__controls-group">
        <button class="stage-v2__btn stage-v2__btn--font" id="stage-v2-font-decrease" type="button" aria-label="Reducir tamaño de letra">A−</button>
        <button class="stage-v2__btn stage-v2__btn--font" id="stage-v2-font-increase" type="button" aria-label="Aumentar tamaño de letra">A+</button>
      </div>
      <div class="stage-v2__controls-group">
        <button class="stage-v2__btn" id="stage-v2-prev" type="button" aria-label="Línea anterior">${icon('chevron-left', { size: 22 })}</button>
        <button class="stage-v2__btn stage-v2__btn--exit" id="stage-v2-exit" type="button" aria-label="Salir del modo escenario">${icon('close', { size: 22 })}</button>
        <button class="stage-v2__btn" id="stage-v2-next" type="button" aria-label="Siguiente línea">${icon('chevron-right', { size: 22 })}</button>
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
    .map((c) => {
      const isActive = c === activeCategory;
      const initial = c === 'contralto' ? 'A' : getVoiceLabel(c).charAt(0).toUpperCase();
      return `
      <button
        type="button"
        class="stage-v2__voice-chip${isActive ? ' stage-v2__voice-chip--active' : ''}"
        data-category="${c}"
        style="--voice-chip-color: var(--color-voice-${c})"
        aria-pressed="${isActive}"
        aria-label="Voz: ${escapeHtml(getVoiceLabel(c))}"
      >${initial}</button>`;
    })
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

/** Pinta las 3 zonas (previa/actual/siguiente) + label de sección + progreso. */
function renderZone(s) {
  const { lines, index, els } = s;
  const cur = lines[index];
  const prev = lines[index - 1] || null;
  const next = lines[index + 1] || null;

  els.prevLine.textContent = prev ? prev.text : '';
  els.nextLine.textContent = next ? next.text : '';

  els.currentText.textContent = cur.text;
  els.currentText.classList.toggle('stage-v2__text--spoken', cur.spoken);
  els.currentEl.style.fontSize = `${(computeBaseFontRem(cur.text.length) * s.fontScale).toFixed(2)}rem`;
  els.chords.innerHTML = renderChordsRow(cur);

  els.sectionLabel.textContent = cur.sectionLabel;
  els.sectionLabel.className = `stage-v2__section-label stage-v2__section-label--${cur.sectionType}`;

  const pct = lines.length > 1 ? (index / (lines.length - 1)) * 100 : 0;
  els.progressFill.style.height = `${pct}%`;

  els.prevBtn.disabled = index === 0;
  els.nextBtn.disabled = index === lines.length - 1;
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

/** Ajusta la velocidad de avance ±GESTURE_SPEED_STEP, persiste y re-proyecta. */
function adjustSpeed(s, delta) {
  const next = Math.max(AUTOSCROLL_SPEED_MIN, Math.min(AUTOSCROLL_SPEED_MAX, s.speed + delta));
  if (next === s.speed) return; // ya en el límite, sin feedback
  s.speed = next;
  saveBaseSpeed(next, s.songId);
  recomputeLines(s);
  renderZone(s);
  scheduleAdvance(s);
  showFeedback(s, `Velocidad ${speedToPercentLabel(next)}`);
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
  if (typeof s.ctx.setActiveVoice === 'function') s.ctx.setActiveVoice(category);
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
 *           setActiveVoice?: (category: string) => void }} ctx contexto vivo desde SongView;
 *           setActiveVoice sincroniza el chip S·A·T·B del escenario con el selector de voz de SongView.
 */
export function enterStage(songViewEl, ctx = {}) {
  if (session || !songViewEl || !ctx.song) return; // idempotente

  const songId = ctx.song.id;
  const activeVoiceId = typeof ctx.getActiveVoice === 'function' ? ctx.getActiveVoice() : null;
  const lines = projectLines(ctx.song, { ...ctx, getActiveVoice: () => activeVoiceId, songId });
  if (lines.length === 0) return; // nada que proyectar

  songViewEl.classList.add('song-view--stage');
  document.body.classList.add('stage-active');

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

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
    controls: overlay.querySelector('#stage-v2-controls'),
    prevBtn: overlay.querySelector('#stage-v2-prev'),
    nextBtn: overlay.querySelector('#stage-v2-next'),
    exitBtn: overlay.querySelector('#stage-v2-exit'),
    fontDecreaseBtn: overlay.querySelector('#stage-v2-font-decrease'),
    fontIncreaseBtn: overlay.querySelector('#stage-v2-font-increase'),
  };

  const wl = createWakeLock();
  session = {
    songViewEl,
    overlay,
    els,
    song: ctx.song,
    ctx,
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
  };

  const activeCategory = (ctx.song.voiceRoster || []).find((v) => v.id === activeVoiceId)?.category ?? null;
  els.voiceChips.innerHTML = renderVoiceChips(ctx.song, activeCategory);

  wl.acquire();
  if (wl.supported) els.wakelock.hidden = false;

  renderZone(session);
  scheduleAdvance(session);
  session.hintTimer = setTimeout(() => els.hint.classList.add('stage-v2__hint--hidden'), HINT_DURATION_MS);
  showControls(session);

  // Tap en el área central (no en los controles ni chips) = pausa/reanuda.
  // Un swipe ya manejado por onPointerUp marca suppressClick para no pausar además.
  const onTap = (e) => {
    if (e.target.closest('.stage-v2__controls') || e.target.closest('.stage-v2__voice-chips')) return;
    if (session.suppressClick) {
      session.suppressClick = false;
      return;
    }
    showControls(session);
    togglePause(session);
  };
  els.tapArea.addEventListener('click', onTap);

  // Gestos: swipe vertical = velocidad ±, swipe horizontal = línea sig/ant.
  // Umbral de tap (<10px) vs swipe (>=40px); por debajo de ambos no hace nada
  // (lo resuelve el listener de click de arriba).
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
    if (adx < TAP_THRESHOLD_PX && ady < TAP_THRESHOLD_PX) return; // tap: lo maneja onTap
    session.suppressClick = true;
    showControls(session);
    if (ady > adx && ady >= SWIPE_THRESHOLD_PX) {
      adjustSpeed(session, dy < 0 ? GESTURE_SPEED_STEP : -GESTURE_SPEED_STEP);
    } else if (adx > ady && adx >= SWIPE_THRESHOLD_PX) {
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

  const onFontDecrease = () => {
    session.fontScale = Math.max(FONT_SCALE_MIN, session.fontScale - FONT_SCALE_STEP);
    saveFontScale(session.fontScale);
    renderZone(session);
    showControls(session);
  };
  const onFontIncrease = () => {
    session.fontScale = Math.min(FONT_SCALE_MAX, session.fontScale + FONT_SCALE_STEP);
    saveFontScale(session.fontScale);
    renderZone(session);
    showControls(session);
  };
  els.fontDecreaseBtn.addEventListener('click', onFontDecrease);
  els.fontIncreaseBtn.addEventListener('click', onFontIncrease);

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
    onFontDecrease,
    onFontIncrease,
    onVoiceChipClick,
    onKey,
    onVis,
    onNav,
  });
}

export function exitStage() {
  if (!session) return; // idempotente
  const {
    songViewEl,
    overlay,
    els,
    wl,
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
    onFontDecrease,
    onFontIncrease,
    onVoiceChipClick,
    onKey,
    onVis,
    onNav,
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
  els.fontDecreaseBtn.removeEventListener('click', onFontDecrease);
  els.fontIncreaseBtn.removeEventListener('click', onFontIncrease);
  els.voiceChips.removeEventListener('click', onVoiceChipClick);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('hashchange', onNav);
  window.removeEventListener('popstate', onNav);

  wl.release();
  exitStageFullscreen();

  overlay.remove();
  songViewEl.classList.remove('song-view--stage');
  document.body.classList.remove('stage-active');

  session = null;
}
