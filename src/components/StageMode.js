import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { createWakeLock } from '../lib/wakeLock.js';
import { requestStageFullscreen, exitStageFullscreen } from '../lib/fullscreen.js';
import { groupsForVoice } from '../lib/voiceSystem.js';
import { transposeChord, transposeNote } from '../lib/lyricsRender.js';
import { displayChord, displayNote } from '../lib/chordNotation.js';
import { presetToSpeed } from '../lib/autoscroll.js';
import '../styles/stage.css';

// ── Sección: tipo → slug/etiqueta ──
// Duplica normalizeSectionType (SongView.js) a propósito: importar desde
// SongView.js crearía un ciclo (SongView importa enterStage de aquí). Es la
// misma lista de 6 slugs fijos (spec F1 D1 §3); si cambia allá, cambia aquí.
const KNOWN_SECTION_TYPES = ['verse', 'chorus', 'bridge', 'prechorus', 'intro', 'outro'];
const SECTION_TYPE_ALIASES = {
  verso: 'verse',
  estribillo: 'chorus',
  coro: 'chorus',
  puente: 'bridge',
  'pre-estribillo': 'prechorus',
  'pre-coro': 'prechorus',
  precoro: 'prechorus',
};
const SECTION_TYPE_LABELS = {
  verse: 'VERSO',
  chorus: 'CORO',
  bridge: 'PUENTE',
  prechorus: 'PRE-CORO',
  intro: 'INTRO',
  outro: 'OUTRO',
};

/**
 * @param {string} [type]
 * @returns {string} uno de los 6 slugs conocidos (desconocido → 'verse')
 */
function normalizeSectionType(type) {
  const slug = (type || '').toString().trim().toLowerCase();
  if (KNOWN_SECTION_TYPES.includes(slug)) return slug;
  return SECTION_TYPE_ALIASES[slug] || 'verse';
}

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

// ── Tamaño auto-fit de la línea actual ──
const FONT_MIN_REM = 1.6;
const FONT_MAX_REM = 3.2;
const FONT_MIN_CHARS = 20; // líneas <= 20 chars: tamaño máximo
const FONT_MAX_CHARS = 80; // líneas >= 80 chars: tamaño mínimo

/**
 * Interpola el font-size de la línea actual según su longitud (clamp
 * 1.6rem..3.2rem, más grande cuanto más corta la línea).
 * @param {number} length
 * @returns {string} p.ej. "2.40rem"
 */
function computeCurrentFontSize(length) {
  if (length <= FONT_MIN_CHARS) return `${FONT_MAX_REM}rem`;
  if (length >= FONT_MAX_CHARS) return `${FONT_MIN_REM}rem`;
  const t = (length - FONT_MIN_CHARS) / (FONT_MAX_CHARS - FONT_MIN_CHARS);
  const rem = FONT_MAX_REM - t * (FONT_MAX_REM - FONT_MIN_REM);
  return `${rem.toFixed(2)}rem`;
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

let session = null; // { songViewEl, overlay, els, lines, index, paused, timer, hintTimer, wl, handlers } | null

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'stage-v2';
  overlay.innerHTML = `
    <div class="stage-v2__top">
      <span class="stage-v2__section-label" id="stage-v2-section"></span>
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
    </div>
    <div class="stage-v2__controls">
      <button class="stage-v2__btn" id="stage-v2-prev" type="button" aria-label="Línea anterior">${icon('chevron-left', { size: 22 })}</button>
      <button class="stage-v2__btn stage-v2__btn--exit" id="stage-v2-exit" type="button" aria-label="Salir del modo escenario">${icon('close', { size: 22 })}</button>
      <button class="stage-v2__btn" id="stage-v2-next" type="button" aria-label="Siguiente línea">${icon('chevron-right', { size: 22 })}</button>
    </div>`;
  return overlay;
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
  els.currentEl.style.fontSize = computeCurrentFontSize(cur.text.length);
  els.chords.innerHTML = renderChordsRow(cur);

  els.sectionLabel.textContent = cur.sectionLabel;
  els.sectionLabel.className = `stage-v2__section-label stage-v2__section-label--${cur.sectionType}`;

  const pct = lines.length > 1 ? (index / (lines.length - 1)) * 100 : 0;
  els.progressFill.style.height = `${pct}%`;

  els.prevBtn.disabled = index === 0;
  els.nextBtn.disabled = index === lines.length - 1;
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
 *           getNotation?: () => 'anglo'|'latin' }} ctx contexto vivo desde SongView
 */
export function enterStage(songViewEl, ctx = {}) {
  if (session || !songViewEl || !ctx.song) return; // idempotente

  const lines = projectLines(ctx.song, { ...ctx, songId: ctx.song.id });
  if (lines.length === 0) return; // nada que proyectar

  songViewEl.classList.add('song-view--stage');
  document.body.classList.add('stage-active');

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  const els = {
    overlay,
    sectionLabel: overlay.querySelector('#stage-v2-section'),
    wakelock: overlay.querySelector('#stage-v2-wakelock'),
    tapArea: overlay.querySelector('#stage-v2-tap'),
    prevLine: overlay.querySelector('#stage-v2-prev-line'),
    currentEl: overlay.querySelector('#stage-v2-current'),
    chords: overlay.querySelector('#stage-v2-chords'),
    currentText: overlay.querySelector('#stage-v2-text'),
    nextLine: overlay.querySelector('#stage-v2-next-line'),
    hint: overlay.querySelector('#stage-v2-hint'),
    progressFill: overlay.querySelector('#stage-v2-progress-fill'),
    prevBtn: overlay.querySelector('#stage-v2-prev'),
    nextBtn: overlay.querySelector('#stage-v2-next'),
    exitBtn: overlay.querySelector('#stage-v2-exit'),
  };

  const wl = createWakeLock();
  session = { songViewEl, overlay, els, lines, index: 0, paused: false, timer: null, hintTimer: null, wl };

  wl.acquire();
  if (wl.supported) els.wakelock.hidden = false;

  renderZone(session);
  scheduleAdvance(session);
  session.hintTimer = setTimeout(() => els.hint.classList.add('stage-v2__hint--hidden'), HINT_DURATION_MS);

  // Tap en el área central (no en los controles) = pausa/reanuda.
  const onTap = (e) => {
    if (e.target.closest('.stage-v2__controls')) return;
    togglePause(session);
  };
  els.tapArea.addEventListener('click', onTap);

  const onPrev = () => goTo(session, session.index - 1);
  const onNext = () => goTo(session, session.index + 1);
  els.prevBtn.addEventListener('click', onPrev);
  els.nextBtn.addEventListener('click', onNext);
  els.exitBtn.addEventListener('click', () => exitStage());

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

  Object.assign(session, { onTap, onPrev, onNext, onKey, onVis, onNav });
}

export function exitStage() {
  if (!session) return; // idempotente
  const { songViewEl, overlay, els, wl, timer, hintTimer, onTap, onPrev, onNext, onKey, onVis, onNav } = session;

  clearTimeout(timer);
  clearTimeout(hintTimer);

  els.tapArea.removeEventListener('click', onTap);
  els.prevBtn.removeEventListener('click', onPrev);
  els.nextBtn.removeEventListener('click', onNext);
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
