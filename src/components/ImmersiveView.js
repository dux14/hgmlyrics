/**
 * ImmersiveView.js — Vista inmersiva de canción (karaoke estilo Apple Music).
 *
 * Reemplaza al extinto modo escenario (C5) con un rollo completo de letra:
 * TODAS las líneas montadas de una vez, línea activa nítida/grande, resto
 * atenuado por distancia (blur+opacity), posición animada con un spring
 * interrumpible (spring.js) en vez de scrollIntoView. Contrato de
 * entrada/salida (`enterImmersive`/`exitImmersive`) es el mismo que tenía el
 * modo escenario, para que SongView lo consuma sin cambios de ctx (Task C5).
 *
 * Motor de avance de esta fase: SOLO TimerEngine (segundos-por-línea desde
 * autoscroll.js). TimingEngine (audio real vía
 * `song_line_timings`) y la barra de player son Fase D — esta task deja los
 * slots montados más vacíos.
 */
import { icon } from '../lib/icons.js';
import { createWakeLock } from '../lib/wakeLock.js';
import { rosterByCategory, CANONICAL_VOICE_ORDER, getVoiceLabel } from '../lib/voiceSystem.js';
import {
  buildLetraLineHTML,
  buildChordsLineHTML,
  buildTonoLineHTML,
  buildMixedLineHTML,
} from '../lib/lyricsRender.js';
import { setChordNotation } from '../lib/chordNotation.js';
import {
  AUTOSCROLL_SPEED_MIN,
  AUTOSCROLL_SPEED_MAX,
  getAutoscrollSpeed as readBaseSpeed,
  saveAutoscrollSpeed as saveBaseSpeed,
  speedToPercentLabel,
} from '../lib/autoscroll.js';
import { buildVoiceChipHTML } from '../lib/voiceChips.js';
import { openFloatingTuner } from './FloatingTuner.js';
import { getLayers } from '../lib/layerStore.js';
import { isFeatureEnabled } from '../lib/authStore.js';
import { openOptionsSheet, closeOptionsSheet } from './OptionsSheet.js';
import { projectLines } from '../lib/projectLines.js';
import {
  resolveInitialMode,
  setImmersiveMode,
  availableModes,
} from '../lib/immersiveStore.js';
import { createSpring } from '../lib/spring.js';
import '../styles/immersive.css';

// Duración por línea en el extremo lento (fallback de scheduleAdvance cuando
// aún no hay líneas proyectadas) — mismo valor que projectLines.js.
const SECONDS_PER_LINE_SLOW = 9;

const MODE_LABELS = {
  letra: 'Letra',
  chords: '+Acordes',
  mixed: '+Ac.+Tono',
  tono: '+Tono',
};

// ── Escala de fuente del rollo (controles A−/A+) — MISMA clave que usaba el
// extinto modo escenario (F3/T6): reusar la preferencia ya persistida en
// localStorage es intencional, no un accidente — es la MISMA perilla "tamaño
// de letra en modo lectura activa".
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

const CONTROLS_HIDE_MS = 3000;
const SWIPE_THRESHOLD_PX = 40;
const GESTURE_SPEED_STEP = 0.1;
const SCROLL_CENTER_RATIO = 0.38; // línea activa centrada al 38% del alto del viewport

let session = null;

/**
 * Réplica local del helper homónimo de SongView (misma convención en ambas
 * vistas): decide si el toggle de acordes tiene sentido.
 * @param {object} song @returns {boolean}
 */
function songHasChords(song) {
  return (song?.sections || []).some((s) => s.lines?.some((l) => l.chords && l.chords.length > 0));
}

// ── OVERLAY ──────────────────────────────────────────────────────────────

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'imm-v1';
  overlay.innerHTML = `
    <div class="imm-v1__chrome" id="imm-chrome">
      <button class="imm-v1__btn imm-v1__exit" id="imm-exit" type="button" aria-label="Salir de la vista inmersiva">${icon('close', { size: 22 })}</button>
      <span class="imm-v1__section" id="imm-section"></span>
      <div class="imm-v1__voice-chips" id="imm-voice-chips" hidden></div>
      <button class="imm-v1__btn imm-v1__options" id="imm-open-options" type="button" aria-label="Opciones">${icon('sliders', { size: 18 })}</button>
    </div>
    <div class="imm-v1__viewport" id="imm-viewport">
      <div class="imm-roll" id="imm-roll"></div>
    </div>
    <button class="imm-v1__fab" id="imm-fab" type="button" aria-label="Pausar avance automático">
      <span id="imm-fab-icon">${icon('pause', { size: 22 })}</span>
    </button>
    <div class="imm-v1__bottombar" id="imm-bottombar">
      <button class="imm-v1__btn imm-v1__tuner-toggle" id="imm-tuner-toggle" type="button" aria-pressed="false" aria-label="Activar afinador">${icon('mic', { size: 20 })}</button>
      <div class="imm-v1__player-slot" id="imm-player-slot" hidden></div>
    </div>
    <div class="imm-v1__tuner-panel" id="imm-tuner-panel" hidden></div>`;
  return overlay;
}

/** Chips compactos S·A·T·B — solo visibles en modos mixed/tono (spec §1). */
function renderVoiceChips(song, activeCategory) {
  const categories = CANONICAL_VOICE_ORDER.filter((c) => rosterByCategory(song, c).length > 0);
  if (categories.length === 0) return '';
  return categories
    .map((c) =>
      buildVoiceChipHTML(c, { active: c === activeCategory, prefix: 'imm-v1__voice-chip' }),
    )
    .join('');
}

// ── RENDER POR MODO ──────────────────────────────────────────────────────

/**
 * Contenido de UNA línea según el modo activo (immersiveStore). Regla del
 * spec §1: `chords` usa el mismo builder en TODAS las líneas (la atenuación
 * es puramente visual, vía las clases de distancia); `mixed`/`tono` solo la
 * línea ACTIVA usa el builder rico (3 rieles / nota flotante) — el resto cae
 * a acordes (mixed) o letra limpia (tono), sin importar la distancia.
 * @param {object} s sesión @param {object} line línea proyectada @param {boolean} isActive
 * @returns {string} HTML
 */
function buildLineContent(s, line, isActive) {
  if (line.spoken || line.text.trim() === '') return buildLetraLineHTML(line.text);

  if (s.mode === 'letra') return buildLetraLineHTML(line.text);

  const { semitones = 0, useFlats = false } =
    (typeof s.ctx.getTranspose === 'function' ? s.ctx.getTranspose() : null) || {};
  const notation = typeof s.ctx.getNotation === 'function' ? s.ctx.getNotation() : 'anglo';

  if (s.mode === 'chords') {
    return buildChordsLineHTML(line.text, line.chordsRaw, {
      transposeSemitones: semitones,
      useFlats,
      notation,
    });
  }

  const category = (s.song.voiceRoster || []).find((v) => v.id === s.activeVoiceId)?.category ?? null;
  const colorClass = category ? `voice-text--${category}` : '';
  const lineObj = { text: line.text, groups: line.groups };

  if (s.mode === 'mixed') {
    if (isActive && s.activeVoiceId) {
      return buildMixedLineHTML(lineObj, line.chordsRaw, s.activeVoiceId, colorClass, {
        transposeSemitones: semitones,
        useFlats,
        notation,
      });
    }
    return buildChordsLineHTML(line.text, line.chordsRaw, {
      transposeSemitones: semitones,
      useFlats,
      notation,
    });
  }

  // mode === 'tono'
  if (isActive && s.activeVoiceId) {
    return buildTonoLineHTML(lineObj, s.activeVoiceId, colorClass, { notation });
  }
  return buildLetraLineHTML(line.text);
}

/** Clase de distancia (spec §1): activa/±1/±2/±3/resto. */
function distanceClass(dist) {
  if (dist === 0) return 'imm-line--active';
  if (dist === 1) return 'imm-line--d1';
  if (dist === 2) return 'imm-line--d2';
  if (dist === 3) return 'imm-line--d3';
  return 'imm-line--far';
}

const DISTANCE_CLASSES = [
  'imm-line--active',
  'imm-line--d1',
  'imm-line--d2',
  'imm-line--d3',
  'imm-line--far',
];

function updateDistanceClasses(s) {
  s.lineEls.forEach((el, i) => {
    el.classList.remove(...DISTANCE_CLASSES);
    el.classList.add(distanceClass(Math.abs(i - s.index)));
  });
}

/** Monta TODAS las líneas de una vez (spec §1) y aplica las clases de distancia. */
function renderRoll(s) {
  s.els.roll.innerHTML = s.lines
    .map((line, i) => {
      const isActive = i === s.index;
      const spokenCls = line.spoken ? ' imm-line--spoken' : '';
      return `<div class="imm-line${spokenCls}" data-i="${i}">${buildLineContent(s, line, isActive)}</div>`;
    })
    .join('');
  s.lineEls = Array.from(s.els.roll.children);
  updateDistanceClasses(s);
}

/** Re-pinta el contenido de UNA línea (se llama en `goTo` para el índice viejo y el nuevo). */
function renderLineContent(s, index) {
  const el = s.lineEls[index];
  const line = s.lines[index];
  if (!el || !line) return;
  el.innerHTML = buildLineContent(s, line, index === s.index);
}

function updateSectionLabel(s) {
  const cur = s.lines[s.index];
  s.els.sectionLabel.textContent = cur.sectionLabel;
  s.els.sectionLabel.className = `imm-v1__section imm-v1__section--${cur.sectionType}`;
}

/**
 * Actualiza la nota disponible del widget híbrido con la de la línea activa
 * para la voz elegida (ciencia, "F#3"). El widget decide solo si la usa
 * (chip "Seguir nota" propio) — acá solo se alimenta el dato; sin panel
 * abierto es no-op.
 */
function updateTunerNote(s) {
  if (!s.floatingTuner) return;
  const cur = s.lines[s.index];
  s.floatingTuner.setNote(cur?.noteRaw ?? null);
}

// ── SCROLL (spring interrumpible, spring.js) ────────────────────────────

/** Reasigna el target del spring a la línea activa y (re)arranca el loop rAF. */
function retargetScroll(s) {
  const activeEl = s.lineEls[s.index];
  if (!activeEl) return;
  const viewportH = s.els.viewport.clientHeight;
  const centerY = activeEl.offsetTop + activeEl.offsetHeight / 2;
  s.spring.setTarget(viewportH * SCROLL_CENTER_RATIO - centerY);
  startScrollLoop(s);
}

function startScrollLoop(s) {
  if (s.rafId !== null) return; // ya corriendo
  s.lastFrameTs = null;
  const loop = (ts) => {
    if (s.lastFrameTs === null) s.lastFrameTs = ts;
    const dt = ts - s.lastFrameTs;
    s.lastFrameTs = ts;
    const moving = s.spring.step(dt);
    s.els.roll.style.transform = `translateY(${s.spring.getValue()}px)`;
    if (moving) s.rafId = requestAnimationFrame(loop);
    else s.rafId = null;
  };
  s.rafId = requestAnimationFrame(loop);
}

function stopScrollLoop(s) {
  if (s.rafId !== null) cancelAnimationFrame(s.rafId);
  s.rafId = null;
}

// ── MOTOR DE AVANCE (TimerEngine embebido — TimingEngine es Fase D) ──────

function scheduleAdvance(s) {
  clearTimeout(s.timer);
  if (s.paused) return;
  const cur = s.lines[s.index];
  const ms = Math.max(500, (cur?.seconds ?? SECONDS_PER_LINE_SLOW) * 1000);
  s.timer = setTimeout(() => goTo(s, s.index + 1), ms);
}

/** Navega a `index` (clampado): re-pinta contenido/distancia/scroll y reprograma el timer. */
function goTo(s, index) {
  const clamped = Math.max(0, Math.min(s.lines.length - 1, index));
  const prevIndex = s.index;
  s.index = clamped;
  updateDistanceClasses(s);
  if (clamped !== prevIndex) {
    renderLineContent(s, prevIndex);
    renderLineContent(s, clamped);
  }
  updateSectionLabel(s);
  updateTunerNote(s);
  retargetScroll(s);
  scheduleAdvance(s);
}

function togglePause(s) {
  s.paused = !s.paused;
  s.els.overlay.classList.toggle('imm-v1--paused', s.paused);
  s.els.fabIcon.innerHTML = icon(s.paused ? 'play' : 'pause', { size: 22 });
  s.els.fab.setAttribute('aria-label', s.paused ? 'Reanudar avance automático' : 'Pausar avance automático');
  if (s.paused) clearTimeout(s.timer);
  else scheduleAdvance(s);
  showControls(s);
}

function applySpeed(s, next) {
  s.speed = next;
  saveBaseSpeed(next, s.songId);
  recomputeLines(s);
  scheduleAdvance(s);
}

function adjustSpeed(s, delta) {
  const next = Math.max(AUTOSCROLL_SPEED_MIN, Math.min(AUTOSCROLL_SPEED_MAX, s.speed + delta));
  if (next === s.speed) return;
  applySpeed(s, next);
}

/** Re-proyecta `s.lines` (voz/velocidad/transposición vigentes), preservando el índice. */
function recomputeLines(s) {
  s.lines = projectLines(s.song, {
    getActiveVoice: () => s.activeVoiceId,
    getTranspose: s.ctx.getTranspose,
    getNotation: s.ctx.getNotation,
    songId: s.songId,
  });
  s.index = Math.max(0, Math.min(s.lines.length - 1, s.index));
  renderRoll(s);
  updateSectionLabel(s);
  updateTunerNote(s);
  retargetScroll(s);
}

// ── CONTROLES / CHROME AUTO-HIDE ──────────────────────────────────────────

/** Muestra el chrome y reprograma su auto-ocultado a 3s; fijo mientras está en pausa. */
function showControls(s) {
  clearTimeout(s.hideControlsTimer);
  s.els.chrome.classList.remove('imm-v1__chrome--hidden');
  if (s.paused) return;
  s.hideControlsTimer = setTimeout(() => {
    s.els.chrome.classList.add('imm-v1__chrome--hidden');
  }, CONTROLS_HIDE_MS);
}

// ── MODO / VOZ ─────────────────────────────────────────────────────────

function updateVoiceChipsVisibility(s) {
  s.els.voiceChips.hidden = !(s.mode === 'mixed' || s.mode === 'tono');
}

/**
 * Cambia el modo de contenido (persistido en immersiveStore) y re-renderiza
 * TODAS las líneas — el modo cambia el builder de cada línea, no solo el de
 * la activa. Modo 'tono' sin voz elegida auto-abre el sheet en la voz (paridad
 * con el fix fd8ea72 del extinto modo escenario/SongView: sin esto el usuario
 * no ve dónde elegir su voz).
 * @param {object} s @param {string} mode
 */
function applyMode(s, mode) {
  if (!s.modes.includes(mode)) return;
  s.mode = mode;
  setImmersiveMode(mode);
  renderRoll(s);
  updateSectionLabel(s);
  updateVoiceChipsVisibility(s);
  retargetScroll(s);
  if (mode === 'tono' && !s.activeVoiceId) openOptions(s);
}

function selectVoice(s, category) {
  const people = rosterByCategory(s.song, category);
  if (people.length === 0) return;
  s.activeVoiceId = people[0].id;
  recomputeLines(s);
  s.els.voiceChips.innerHTML = renderVoiceChips(s.song, category);
  if (typeof s.ctx.setActiveVoice === 'function') s.ctx.setActiveVoice(category, people[0].id);
  // El widget híbrido no expone un setter de etiqueta de voz — con el panel
  // abierto, un cambio de voz lo reabre para refrescar `voiceLabel` (el
  // `note` ya se actualizó vía recomputeLines -> updateTunerNote).
  if (s.tunerOn) {
    setTunerOn(s, false);
    setTunerOn(s, true);
  }
}

// ── SHEET DE OPCIONES ─────────────────────────────────────────────────────

function openOptions(s) {
  showControls(s);
  const activeCategory =
    (s.song.voiceRoster || []).find((v) => v.id === s.activeVoiceId)?.category ?? null;
  openOptionsSheet({
    showTono: false, // sin setter de transposición propio en el ctx
    notation: typeof s.ctx.getNotation === 'function' ? s.ctx.getNotation() : 'anglo',
    fontLabel: s.fontScale.toFixed(2),
    autoscrollLabel: speedToPercentLabel(s.speed),
    showAutoscroll: true, // solo hay TimerEngine en esta fase
    modes: s.modes.map((m) => ({ value: m, label: MODE_LABELS[m] })),
    mode: s.mode,
    voiceOptions:
      s.mode === 'mixed' || s.mode === 'tono'
        ? CANONICAL_VOICE_ORDER.filter((c) => rosterByCategory(s.song, c).length > 0).map((c) => ({
            value: c,
            label: getVoiceLabel(c),
          }))
        : [],
    activeVoiceCategory: activeCategory,
    showTuner: true,
    tunerOn: s.tunerOn,
    onModeChange: (mode) => applyMode(s, mode),
    onVoiceChange: (category) => selectVoice(s, category),
    onNotationChange: (value) => {
      setChordNotation(value);
      renderRoll(s);
      // Los labels de acorde/nota cambian de ancho (Do Re Mi vs A B C):
      // reflow de geometría -> hay que recentrar el ancla del 38%, igual que
      // los demás mutadores que tocan la altura/tamaño de las líneas.
      retargetScroll(s);
    },
    onFont: (dir) => {
      s.fontScale = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, s.fontScale + dir * FONT_SCALE_STEP));
      saveFontScale(s.fontScale);
      s.els.overlay.style.setProperty('--imm-font-scale', s.fontScale.toFixed(2));
      const of = document.querySelector('#osheet-font');
      if (of) of.textContent = s.fontScale.toFixed(2);
      // La escala de fuente cambia la altura de cada línea: recentrar.
      retargetScroll(s);
    },
    onAutoscroll: (dir) => {
      adjustSpeed(s, dir * GESTURE_SPEED_STEP);
      return speedToPercentLabel(s.speed);
    },
    onTunerToggle: (on) => setTunerOn(s, on),
    onClose: () => showControls(s),
  });
}

// ── AFINADOR (franja + "Seguir nota") ─────────────────────────────────────

/**
 * Toggle del afinador híbrido (widget aprobado, `FloatingTuner.js`): el mic
 * SOLO arranca por este gesto (abrir el panel llama a `openFloatingTuner`,
 * que arranca el detector) y se detiene SIEMPRE al cerrarlo (`destroy()`).
 * El widget abre en modo libre; su propio chip "Seguir nota" es el que ancla
 * a la nota de la línea activa (alimentada por `updateTunerNote`).
 * @param {object} s @param {boolean} on
 */
function setTunerOn(s, on) {
  s.tunerOn = on;
  s.els.tunerToggle.setAttribute('aria-pressed', String(on));
  s.els.tunerPanel.hidden = !on;
  if (on) {
    const category = (s.song.voiceRoster || []).find((v) => v.id === s.activeVoiceId)?.category ?? null;
    const cur = s.lines[s.index];
    s.floatingTuner = openFloatingTuner(s.els.tunerPanel, {
      note: cur?.noteRaw ?? null,
      voiceLabel: category ? getVoiceLabel(category) : 'Afinador',
      onClose: () => {
        s.floatingTuner = null;
        s.tunerOn = false;
        s.els.tunerToggle.setAttribute('aria-pressed', 'false');
        s.els.tunerPanel.hidden = true;
      },
    });
  } else {
    s.floatingTuner?.destroy();
    s.floatingTuner = null;
  }
}

// ── ENTRAR / SALIR ─────────────────────────────────────────────────────

/**
 * Entra a la vista inmersiva: proyecta `ctx.song` y monta el rollo completo.
 * Idempotente; no-op sin canción o sin líneas proyectables. Mismo ctx que
 * tenía la función de entrada del extinto modo escenario — contrato estable
 * para el swap de C5.
 * @param {HTMLElement} songViewEl
 * @param {{ song: object, getActiveVoice?: () => string|null,
 *           getTranspose?: () => {semitones:number, useFlats:boolean},
 *           getNotation?: () => 'anglo'|'latin',
 *           setActiveVoice?: (category: string, personId?: string) => void,
 *           pauseAutoscroll?: () => void, onExit?: () => void }} ctx
 */
export function enterImmersive(songViewEl, ctx = {}) {
  if (session || !songViewEl || !ctx.song) return; // idempotente

  if (typeof ctx.pauseAutoscroll === 'function') ctx.pauseAutoscroll();

  const songId = ctx.song.id;
  const activeVoiceId = typeof ctx.getActiveVoice === 'function' ? ctx.getActiveVoice() : null;
  const lines = projectLines(ctx.song, { ...ctx, getActiveVoice: () => activeVoiceId, songId });
  if (lines.length === 0) return; // nada que proyectar

  const hasChords = songHasChords(ctx.song);
  const tonoAvailable = isFeatureEnabled('voz_tono') && (ctx.song.voiceRoster || []).length > 0;
  const modes = availableModes({ hasChords, tonoAvailable });
  let mode = resolveInitialMode(getLayers());
  if (!modes.includes(mode)) mode = 'letra';

  songViewEl.classList.add('song-view--immersive');
  document.body.classList.add('immersive-active');

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  const els = {
    overlay,
    chrome: overlay.querySelector('#imm-chrome'),
    exitBtn: overlay.querySelector('#imm-exit'),
    sectionLabel: overlay.querySelector('#imm-section'),
    voiceChips: overlay.querySelector('#imm-voice-chips'),
    openOptionsBtn: overlay.querySelector('#imm-open-options'),
    viewport: overlay.querySelector('#imm-viewport'),
    roll: overlay.querySelector('#imm-roll'),
    fab: overlay.querySelector('#imm-fab'),
    fabIcon: overlay.querySelector('#imm-fab-icon'),
    tunerToggle: overlay.querySelector('#imm-tuner-toggle'),
    tunerPanel: overlay.querySelector('#imm-tuner-panel'),
    playerSlot: overlay.querySelector('#imm-player-slot'),
  };

  const wl = createWakeLock();
  const fontScale = readFontScale();
  overlay.style.setProperty('--imm-font-scale', fontScale.toFixed(2));

  session = {
    songViewEl,
    ctx,
    song: ctx.song,
    songId,
    hasChords,
    tonoAvailable,
    modes,
    mode,
    lines,
    lineEls: [],
    index: 0,
    speed: readBaseSpeed(songId),
    activeVoiceId,
    fontScale,
    paused: false,
    timer: null,
    hideControlsTimer: null,
    gesture: null,
    suppressClick: false,
    wl,
    tunerOn: false,
    floatingTuner: null,
    spring: createSpring(),
    rafId: null,
    lastFrameTs: null,
    els,
  };

  const activeCategory =
    (ctx.song.voiceRoster || []).find((v) => v.id === activeVoiceId)?.category ?? null;
  els.voiceChips.innerHTML = renderVoiceChips(ctx.song, activeCategory);
  updateVoiceChipsVisibility(session);

  renderRoll(session);
  updateSectionLabel(session);
  session.spring.snap(0); // sin animación de entrada: arranca ya en posición
  els.roll.style.transform = 'translateY(0px)';
  retargetScroll(session);
  scheduleAdvance(session);

  // El afinador (widget híbrido aprobado, `FloatingTuner.js`) se monta bajo
  // demanda dentro de `#imm-tuner-panel` recién cuando el usuario togglea
  // `#imm-tuner-toggle` (setTunerOn) — nunca auto-arranca el mic al entrar.

  wl.acquire();
  showControls(session);

  // Tap en línea → goTo/seek; tap en zona vacía del rollo → despierta chrome
  // (o pausa si ya estaba visible). Un swipe real marca suppressClick.
  const onViewportClick = (e) => {
    if (session.suppressClick) {
      session.suppressClick = false;
      return;
    }
    const lineEl = e.target.closest('[data-i]');
    if (lineEl) {
      showControls(session);
      goTo(session, Number(lineEl.dataset.i));
      return;
    }
    const chromeHidden = els.chrome.classList.contains('imm-v1__chrome--hidden');
    showControls(session);
    if (chromeHidden) return;
    togglePause(session);
  };
  els.viewport.addEventListener('click', onViewportClick);

  const onPointerDown = (e) => {
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
    if (!isVerticalSwipe && !isHorizontalSwipe) return; // bajo el umbral: lo maneja el click
    session.suppressClick = true;
    showControls(session);
    if (isVerticalSwipe) adjustSpeed(session, dy < 0 ? GESTURE_SPEED_STEP : -GESTURE_SPEED_STEP);
    else goTo(session, session.index + (dx < 0 ? 1 : -1));
  };
  els.viewport.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);

  const onExitClick = () => exitImmersive();
  els.exitBtn.addEventListener('click', onExitClick);

  const onOpenOptions = () => openOptions(session);
  els.openOptionsBtn.addEventListener('click', onOpenOptions);

  const onFabClick = () => togglePause(session);
  els.fab.addEventListener('click', onFabClick);

  const onTunerToggleClick = () => setTunerOn(session, !session.tunerOn);
  els.tunerToggle.addEventListener('click', onTunerToggleClick);

  const onVoiceChipClick = (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    selectVoice(session, btn.dataset.category);
  };
  els.voiceChips.addEventListener('click', onVoiceChipClick);

  const onKey = (e) => {
    if (e.key === 'Escape') exitImmersive();
  };
  document.addEventListener('keydown', onKey);

  const onVis = () => {
    if (document.visibilityState === 'visible') wl.acquire();
  };
  document.addEventListener('visibilitychange', onVis);

  const onNav = () => exitImmersive();
  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);

  Object.assign(session, {
    onViewportClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onExitClick,
    onOpenOptions,
    onFabClick,
    onTunerToggleClick,
    onVoiceChipClick,
    onKey,
    onVis,
    onNav,
  });

  // Modo 'tono' sin voz elegida al entrar (p.ej. heredado de layerStore):
  // auto-abre el sheet en la voz, misma paridad que SongView.
  if (mode === 'tono' && !activeVoiceId) openOptions(session);
}

export function exitImmersive() {
  if (!session) return; // idempotente
  const {
    songViewEl,
    els,
    wl,
    ctx,
    timer,
    hideControlsTimer,
    floatingTuner,
    onViewportClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onExitClick,
    onOpenOptions,
    onFabClick,
    onTunerToggleClick,
    onVoiceChipClick,
    onKey,
    onVis,
    onNav,
  } = session;

  clearTimeout(timer);
  clearTimeout(hideControlsTimer);
  stopScrollLoop(session);

  // El sheet vive fuera del overlay (document.body): si se sale sin cerrarlo
  // queda huérfano sobre la vista normal (mismo bug del extinto modo
  // escenario, T6).
  closeOptionsSheet();

  els.viewport.removeEventListener('click', onViewportClick);
  els.viewport.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  els.exitBtn.removeEventListener('click', onExitClick);
  els.openOptionsBtn.removeEventListener('click', onOpenOptions);
  els.fab.removeEventListener('click', onFabClick);
  els.tunerToggle.removeEventListener('click', onTunerToggleClick);
  els.voiceChips.removeEventListener('click', onVoiceChipClick);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('hashchange', onNav);
  window.removeEventListener('popstate', onNav);

  // Mic nunca queda abierto al salir, esté el toggle en on o off.
  floatingTuner?.destroy();

  wl.release();

  els.overlay.remove();
  songViewEl.classList.remove('song-view--immersive');
  document.body.classList.remove('immersive-active');

  session = null;

  ctx.onExit?.();
}
