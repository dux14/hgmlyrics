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
 * Motor de avance: arranca SIEMPRE en TimerEngine (segundos-por-línea desde
 * autoscroll.js, sin bloquear la entrada) y se promueve en caliente a
 * TimingEngine (audio real vía `song_line_timings`, Task D3) si al resolver
 * `getSongAudio` hay flag `immersive_player` + timings `ready` + audio. Si el
 * <audio> falla en runtime, degrada de vuelta a TimerEngine sin salir de la
 * vista (D3, spec §3).
 */
import { icon } from '../lib/icons.js';
import { getSongAudio } from '../lib/songAudioApi.js';
import { createTimingEngine } from '../lib/timingEngine.js';
import { showToast } from '../lib/toast.js';
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
import { isFeatureEnabled } from '../lib/authStore.js';
import { openOptionsSheet, closeOptionsSheet, isOptionsSheetOpen } from './OptionsSheet.js';
import { projectLines } from '../lib/projectLines.js';
import { getImmersiveMode, setImmersiveMode, availableModes } from '../lib/immersiveStore.js';
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
    <div class="imm-v1__tuner-panel" id="imm-tuner-panel" hidden></div>
    <div class="imm-v1__bottombar" id="imm-bottombar">
      <button class="imm-v1__btn imm-v1__tuner-toggle" id="imm-tuner-toggle" type="button" aria-pressed="false" aria-label="Activar afinador">${icon('mic', { size: 20 })}</button>
      <div class="imm-v1__player-slot" id="imm-player-slot" hidden></div>
    </div>`;
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
 * HTML + clase de modo de UNA línea según el modo activo (immersiveStore),
 * en una sola pasada: antes eran dos funciones (`buildLineContent` +
 * `lineModifierClass`) con el mismo switch duplicado y sincronizadas solo
 * por comentario — una sola fuente de verdad evita que diverjan. Regla del
 * spec §1: `chords` usa el mismo builder en TODAS las líneas (la atenuación
 * es puramente visual, vía las clases de distancia); `mixed`/`tono` solo la
 * línea ACTIVA usa el builder rico (3 rieles / nota flotante) — el resto cae
 * a acordes (mixed) o letra limpia (tono), sin importar la distancia. La
 * clase de modo (`modifierClass`) es la que ubica `.float-label`/`.mix-rail`
 * dentro del ancestro correcto (`lyrics__line--chords/--mix/--tono`, mismas
 * clases de SongView) para que reserven su propio espacio en vez de caer al
 * `position:absolute` por defecto de `.float-label` (bug: acordes pisando la
 * línea de arriba).
 * @param {object} s sesión @param {object} line línea proyectada @param {boolean} isActive
 * @returns {{ html: string, modifierClass: string }}
 */
function buildLine(s, line, isActive) {
  if (line.spoken || line.text.trim() === '') {
    return { html: buildLetraLineHTML(line.text), modifierClass: '' };
  }

  if (s.mode === 'letra') return { html: buildLetraLineHTML(line.text), modifierClass: '' };

  const { semitones = 0, useFlats = false } =
    (typeof s.ctx.getTranspose === 'function' ? s.ctx.getTranspose() : null) || {};
  const notation = typeof s.ctx.getNotation === 'function' ? s.ctx.getNotation() : 'anglo';

  if (s.mode === 'chords') {
    return {
      html: buildChordsLineHTML(line.text, line.chordsRaw, {
        transposeSemitones: semitones,
        useFlats,
        notation,
      }),
      modifierClass: 'lyrics__line--chords',
    };
  }

  const category =
    (s.song.voiceRoster || []).find((v) => v.id === s.activeVoiceId)?.category ?? null;
  const colorClass = category ? `voice-text--${category}` : '';
  const lineObj = { text: line.text, groups: line.groups };

  if (s.mode === 'mixed') {
    if (isActive && s.activeVoiceId) {
      return {
        html: buildMixedLineHTML(lineObj, line.chordsRaw, s.activeVoiceId, colorClass, {
          transposeSemitones: semitones,
          useFlats,
          notation,
        }),
        modifierClass: 'lyrics__line--mix',
      };
    }
    return {
      html: buildChordsLineHTML(line.text, line.chordsRaw, {
        transposeSemitones: semitones,
        useFlats,
        notation,
      }),
      modifierClass: 'lyrics__line--chords',
    };
  }

  // mode === 'tono'
  if (isActive && s.activeVoiceId) {
    return {
      html: buildTonoLineHTML(lineObj, s.activeVoiceId, colorClass, { notation }),
      modifierClass: 'lyrics__line--tono',
    };
  }
  return { html: buildLetraLineHTML(line.text), modifierClass: '' };
}

/** dist FIRMADA (i - index): la siguiente línea queda legible, el resto se atenúa. */
function distanceClass(dist) {
  if (dist === 0) return 'imm-line--active';
  if (dist === 1) return 'imm-line--next';
  const d = Math.abs(dist);
  if (d === 1) return 'imm-line--d1';
  if (d === 2) return 'imm-line--d2';
  if (d === 3) return 'imm-line--d3';
  return 'imm-line--far';
}

const DISTANCE_CLASSES = [
  'imm-line--active',
  'imm-line--next',
  'imm-line--d1',
  'imm-line--d2',
  'imm-line--d3',
  'imm-line--far',
];

function updateDistanceClasses(s) {
  s.lineEls.forEach((el, i) => {
    el.classList.remove(...DISTANCE_CLASSES);
    el.classList.add(distanceClass(i - s.index));
  });
}

/** Monta TODAS las líneas de una vez (spec §1) y aplica las clases de distancia. */
function renderRoll(s) {
  s.els.roll.innerHTML = s.lines
    .map((line, i) => {
      const isActive = i === s.index;
      const spokenCls = line.spoken ? ' imm-line--spoken' : '';
      const { html, modifierClass } = buildLine(s, line, isActive);
      const modifierClsAttr = modifierClass ? ` ${modifierClass}` : '';
      return `<div class="imm-line${spokenCls}${modifierClsAttr}" data-i="${i}">${html}</div>`;
    })
    .join('');
  s.lineEls = Array.from(s.els.roll.children);
  updateDistanceClasses(s);
}

/**
 * Re-pinta el contenido de UNA línea (se llama en `goTo` para el índice viejo
 * y el nuevo). En `mixed`/`tono` el builder de una línea cambia según sea o
 * no la activa — reasigna `className` completo (no solo `innerHTML`) para
 * que la clase de modo (`modifierClass` de `buildLine`) siga la nueva
 * selección; la clase de distancia vigente se preserva y se recalcula aparte
 * en `updateDistanceClasses`.
 */
function renderLineContent(s, index) {
  const el = s.lineEls[index];
  const line = s.lines[index];
  if (!el || !line) return;
  const isActive = index === s.index;
  const { html, modifierClass } = buildLine(s, line, isActive);
  el.innerHTML = html;
  const spokenCls = line.spoken ? ' imm-line--spoken' : '';
  const modifierClsAttr = modifierClass ? ` ${modifierClass}` : '';
  const distanceCls = ` ${distanceClass(index - s.index)}`;
  el.className = `imm-line${spokenCls}${modifierClsAttr}${distanceCls}`;
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

// ── MOTOR DE AVANCE (TimerEngine embebido, o TimingEngine en modo sync) ──

function scheduleAdvance(s) {
  if (s.engineMode === 'sync') return; // en sync manda el audio; pausado = todo pausado
  clearTimeout(s.timer);
  if (s.paused) return;
  const cur = s.lines[s.index];
  const ms = Math.max(500, (cur?.seconds ?? SECONDS_PER_LINE_SLOW) * 1000);
  s.timer = setTimeout(() => goTo(s, s.index + 1), ms);
}

/** Re-pinta contenido/distancia/sección/nota/scroll para `index` (clampado). Compartido por goTo/goToSync. */
function setActiveIndex(s, index) {
  const clamped = Math.max(0, Math.min(s.lines.length - 1, index));
  const prevIndex = s.index;
  s.index = clamped;
  updateDistanceClasses(s);
  // `updateDistanceClasses` ya puso la clase de distancia de `prevIndex`/
  // `clamped` en el className; `renderLineContent` la vuelve a calcular al
  // reasignar `className` completo (necesita reasignarlo entero porque
  // también cambia `modifierClass`). Es sincronía intencional entre ambas
  // funciones, no un cálculo redundante que se pueda quitar — invertir el
  // orden dejaría la línea sin su clase de distancia hasta el próximo tick.
  if (clamped !== prevIndex) {
    renderLineContent(s, prevIndex);
    renderLineContent(s, clamped);
  }
  updateSectionLabel(s);
  updateTunerNote(s);
  retargetScroll(s);
  return clamped;
}

/** Navega a `index` (TimerEngine): re-pinta y reprograma el timer. */
function goTo(s, index) {
  setActiveIndex(s, index);
  scheduleAdvance(s);
}

/**
 * Navega a `index` por un evento del TimingEngine (audio real). `scheduleAdvance`
 * es siempre no-op en sync (el timer nunca conduce ahí); se llama igual por
 * simetría con `goTo` y porque en modo timer sí hace falta.
 */
function goToSync(s, index) {
  removeInterlude(s);
  setActiveIndex(s, index);
  scheduleAdvance(s);
}

function togglePause(s) {
  if (s.engineMode === 'sync') return; // en sync el FAB no existe: pausa = la del player
  s.paused = !s.paused;
  s.els.overlay.classList.toggle('imm-v1--paused', s.paused);
  s.els.fabIcon.innerHTML = icon(s.paused ? 'play' : 'pause', { size: 22 });
  s.els.fab.setAttribute(
    'aria-label',
    s.paused ? 'Reanudar avance automático' : 'Pausar avance automático',
  );
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
  if (s.engineMode === 'sync') return; // la velocidad es del timer; en sync no aplica nunca
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

// ── PLAYER SINCRONIZADO POR TIMINGS (D3, flag `immersive_player`) ────────

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const r = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${r}`;
}

/**
 * Dispara la carga async de audio+timings al entrar (no bloquea el montaje:
 * la vista arranca siempre en TimerEngine — spec §3) y promueve en caliente a
 * TimingEngine si al resolver hay flag + timings `ready` + audio. Cualquier
 * fallo (flag off, sin audio, timings no listos, red caída) deja la vista tal
 * cual estaba: es degradación pura, nunca lanza.
 */
function maybeLoadSyncAudio(s) {
  if (!isFeatureEnabled('immersive_player')) return;
  getSongAudio(s.songId).then((data) => {
    if (session !== s || s.engineMode === 'sync') return; // salió, re-entró o ya se promovió
    const audio = data?.audio;
    const timings = data?.timings;
    if (
      !audio?.url ||
      !timings ||
      timings.status !== 'ready' ||
      !Array.isArray(timings.lines) ||
      timings.lines.length === 0
    ) {
      return;
    }
    promoteToSync(s, audio, timings.lines);
  });
}

/**
 * Promueve la sesión de TimerEngine a TimingEngine: detiene el timer, oculta
 * el FAB para siempre (solo vuelve vía `fallbackToTimer`) y monta `<audio>` +
 * player bar, que queda como el único play disponible. La vista arranca en
 * pausa esperando el play de la barra — con pista, un solo botón de play.
 * No reconcilia la posición del rollo con el
 * `currentTime` del audio al promover (el audio arranca en 0 y el rollo
 * sigue en `s.index`, que en la práctica también es 0 salvo que el usuario
 * ya haya navegado durante la ventana timer-antes-de-promover): el primer
 * `timeupdate` real, al arrancar la reproducción, resincroniza el highlight
 * vía `onLineChange` — decisión deliberada, no un olvido (YAGNI: esperar
 * varios segundos a que resuelva `getSongAudio` para luego forzar un seek
 * inicial es más complejidad de la que vale la pena para ese instante).
 */
function promoteToSync(s, audio, timingLines) {
  if (s.engineMode === 'sync') return;

  const audioEl = document.createElement('audio');
  audioEl.id = 'imm-audio';
  audioEl.src = audio.url;
  audioEl.preload = 'auto';
  s.audioEl = audioEl;
  s.durationSecHint = Number.isFinite(audio.durationSec) ? audio.durationSec : null;

  s.timingLines = timingLines;
  s.timingByLineIndex = new Map(timingLines.map((l, pos) => [l.i, pos]));
  s.timingEngine = createTimingEngine({
    lines: timingLines,
    onLineChange: (pos) => goToSync(s, timingLines[pos].i),
    onInterlude: (payload) => showInterlude(s, payload),
  });
  s.timingEngine.attach(audioEl);

  const onAudioError = () => {
    showToast('No se pudo reproducir la pista de audio', { type: 'error' });
    fallbackToTimer(s);
  };
  audioEl.addEventListener('error', onAudioError);
  s.onAudioError = onAudioError;

  s.engineMode = 'sync';
  clearTimeout(s.timer);
  s.timer = null;
  s.paused = true;
  s.els.overlay.classList.add('imm-v1--paused');
  s.els.fab.hidden = true;
  mountPlayerBar(s);
}

/** Cae en caliente de TimingEngine a TimerEngine (p.ej. error del `<audio>`), sin salir de la vista. */
function fallbackToTimer(s) {
  if (s.engineMode !== 'sync') return;
  s.timingEngine?.detach();
  s.timingEngine = null;
  s.timingLines = [];
  s.timingByLineIndex = new Map();
  unmountPlayerBar(s);
  cleanupAudioEl(s);
  removeInterlude(s);
  s.audioPlaying = false;
  s.els.fab.hidden = false;
  s.paused = false;
  s.els.overlay.classList.remove('imm-v1--paused');
  s.els.fabIcon.innerHTML = icon('pause', { size: 22 });
  s.els.fab.setAttribute('aria-label', 'Pausar avance automático');
  s.engineMode = 'timer';
  scheduleAdvance(s);
}

/** Pausa + vacía + desengancha el `<audio>` (todos los caminos de salida/degradación pasan por acá). */
function cleanupAudioEl(s) {
  if (!s.audioEl) return;
  s.audioEl.pause();
  if (s.onAudioError) s.audioEl.removeEventListener('error', s.onAudioError);
  s.audioEl.src = '';
  s.audioEl.remove();
  s.audioEl = null;
  s.onAudioError = null;
}

/**
 * Seek en modo sync: tap en línea busca su `startMs` y mueve `audio.currentTime`
 * (NO hay `goTo` directo — el highlight llega vía el próximo `timeupdate`,
 * mismo contrato que `timingEngine.seekToLine`). Líneas sin timing propio
 * (mapeo sparse del back, p.ej. instrumentales) caen al último timing conocido
 * en o antes de esa línea.
 */
function seekSyncToLine(s, idx) {
  if (!s.audioEl || !s.timingEngine) return;
  const pos = s.timingByLineIndex.get(idx);
  if (pos !== undefined) {
    s.timingEngine.seekToLine(pos);
    return;
  }
  let best = null;
  for (const l of s.timingLines) {
    if (l.i <= idx) best = l;
    else break;
  }
  if (best) s.audioEl.currentTime = best.startMs / 1000;
}

/** Monta la barra de player en `#imm-player-slot`: scrubber + play/pausa + tiempos + altavoz. */
function mountPlayerBar(s) {
  const slot = s.els.playerSlot;
  slot.hidden = false;
  slot.innerHTML = `
    <div class="imm-player" id="imm-player">
      <button class="imm-player__play" id="imm-player-play" type="button" aria-label="Reproducir pista">${icon('play', { size: 18 })}</button>
      <span class="imm-player__time" id="imm-player-time">0:00</span>
      <input class="imm-player__scrubber" id="imm-player-scrubber" type="range" min="0" max="0" step="0.1" value="0" aria-label="Progreso de la pista" />
      <span class="imm-player__time" id="imm-player-duration">0:00</span>
      <button class="imm-player__mute" id="imm-player-mute" type="button" aria-pressed="false" aria-label="Silenciar pista">${icon('volume-2', { size: 18 })}</button>
    </div>`;
  slot.appendChild(s.audioEl);

  const playBtn = slot.querySelector('#imm-player-play');
  const scrubber = slot.querySelector('#imm-player-scrubber');
  const timeEl = slot.querySelector('#imm-player-time');
  const durEl = slot.querySelector('#imm-player-duration');
  const muteBtn = slot.querySelector('#imm-player-mute');

  // En sync manda siempre el audio: pausar la pista pausa TODO (nunca vuelve
  // el TimerEngine a conducir). El FAB queda oculto para siempre en sync — un
  // solo play, el de esta barra. Avanzar sin oír música es tarea del mute,
  // no de un segundo play.
  const onPlay = () => {
    s.audioPlaying = true;
    // promoteToSync ya detuvo el timer y scheduleAdvance es no-op en sync;
    // este clearTimeout es solo un cinturón redundante, no cubre ninguna
    // carrera real.
    clearTimeout(s.timer);
    s.timer = null;
    s.paused = false;
    s.els.overlay.classList.remove('imm-v1--paused');
    playBtn.innerHTML = icon('pause', { size: 18 });
    playBtn.setAttribute('aria-label', 'Pausar pista');
  };
  const onPause = () => {
    s.audioPlaying = false;
    s.paused = true;
    s.els.overlay.classList.add('imm-v1--paused');
    playBtn.innerHTML = icon('play', { size: 18 });
    playBtn.setAttribute('aria-label', 'Reproducir pista');
    showControls(s);
  };
  const onTimeUpdate = () => {
    scrubber.value = String(s.audioEl.currentTime);
    timeEl.textContent = formatTime(s.audioEl.currentTime);
  };
  const onLoadedMeta = () => {
    scrubber.max = String(s.audioEl.duration || 0);
    durEl.textContent = formatTime(s.audioEl.duration);
  };
  const onPlayBtnClick = () => {
    if (s.audioEl.paused) s.audioEl.play().catch(() => {});
    else s.audioEl.pause();
  };
  const onScrubberInput = () => {
    s.audioEl.currentTime = Number(scrubber.value);
  };
  // Altavoz: silencia la pista sin pausarla (el avance sigue sincronizado al
  // audio, solo deja de sonar).
  const onMuteBtnClick = () => {
    s.audioEl.muted = !s.audioEl.muted;
    muteBtn.innerHTML = icon(s.audioEl.muted ? 'volume-x' : 'volume-2', { size: 18 });
    muteBtn.setAttribute('aria-pressed', String(s.audioEl.muted));
    muteBtn.setAttribute(
      'aria-label',
      s.audioEl.muted ? 'Activar sonido de la pista' : 'Silenciar pista',
    );
  };

  s.audioEl.addEventListener('play', onPlay);
  s.audioEl.addEventListener('pause', onPause);
  s.audioEl.addEventListener('timeupdate', onTimeUpdate);
  s.audioEl.addEventListener('loadedmetadata', onLoadedMeta);
  playBtn.addEventListener('click', onPlayBtnClick);
  scrubber.addEventListener('input', onScrubberInput);
  muteBtn.addEventListener('click', onMuteBtnClick);

  // jsdom no dispara `loadedmetadata` (no decodifica audio real): usa la
  // duración conocida por el backend como fallback inmediato.
  if (Number.isFinite(s.audioEl.duration) && s.audioEl.duration > 0) onLoadedMeta();
  else if (Number.isFinite(s.durationSecHint)) {
    scrubber.max = String(s.durationSecHint);
    durEl.textContent = formatTime(s.durationSecHint);
  }

  s.playerListeners = {
    onPlay,
    onPause,
    onTimeUpdate,
    onLoadedMeta,
    onPlayBtnClick,
    onScrubberInput,
    onMuteBtnClick,
    playBtn,
    scrubber,
    muteBtn,
  };
}

/** Desmonta la barra de player y sus listeners (sin tocar el `<audio>`, eso es `cleanupAudioEl`). */
function unmountPlayerBar(s) {
  const l = s.playerListeners;
  if (l && s.audioEl) {
    s.audioEl.removeEventListener('play', l.onPlay);
    s.audioEl.removeEventListener('pause', l.onPause);
    s.audioEl.removeEventListener('timeupdate', l.onTimeUpdate);
    s.audioEl.removeEventListener('loadedmetadata', l.onLoadedMeta);
    l.playBtn.removeEventListener('click', l.onPlayBtnClick);
    l.scrubber.removeEventListener('input', l.onScrubberInput);
    l.muteBtn.removeEventListener('click', l.onMuteBtnClick);
  }
  s.playerListeners = null;
  s.els.playerSlot.innerHTML = '';
  s.els.playerSlot.hidden = true;
}

/**
 * Nodo `.imm-interlude` (3 puntos) entre la línea `index` y la siguiente,
 * mientras dura el hueco (spec §3, solo modo sync). Reusa el mismo nodo
 * mientras siga siendo el mismo hueco (varios `timeupdate` dentro de él);
 * se retira al entrar la siguiente línea (`goToSync` -> `removeInterlude`).
 */
function showInterlude(s, { index, progress }) {
  if (s.engineMode !== 'sync') return;
  let el = s.els.roll.querySelector('.imm-interlude');
  if (!el || el.dataset.after !== String(index)) {
    removeInterlude(s);
    el = document.createElement('div');
    el.className = 'imm-interlude';
    el.dataset.after = String(index);
    el.innerHTML =
      '<span class="imm-interlude__dot"></span><span class="imm-interlude__dot"></span><span class="imm-interlude__dot"></span>';
    const afterEl = s.lineEls[index];
    if (afterEl) afterEl.insertAdjacentElement('afterend', el);
    else s.els.roll.appendChild(el);
  }
  const dots = el.querySelectorAll('.imm-interlude__dot');
  dots.forEach((dot, i) => {
    const threshold = i / dots.length;
    const local = Math.max(0, Math.min(1, (progress - threshold) * dots.length));
    dot.style.setProperty('--imm-dot-scale', local.toFixed(2));
  });
}

function removeInterlude(s) {
  s.els.roll.querySelector('.imm-interlude')?.remove();
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
 * la activa. Con el sheet ya abierto, todo cambio de modo lo refresca in
 * place. Modo 'tono' o 'mixed' sin voz elegida además auto-abre el sheet en
 * la voz (paridad con el fix fd8ea72 del extinto modo escenario/SongView:
 * sin esto el usuario no ve dónde elegir su voz, y en 'mixed' tampoco vería
 * el tono nunca — cae en silencio a solo-acordes).
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
  // Con el sheet abierto, TODO cambio de modo lo refresca (la sección VOZ
  // aparece/desaparece al instante — fix del bug "cerrar y reabrir");
  // cerrado, se conserva el auto-open solo para tono/mixed sin voz elegida.
  if (isOptionsSheetOpen() || ((mode === 'tono' || mode === 'mixed') && !s.activeVoiceId)) {
    openOptions(s);
  }
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
  const isSync = s.engineMode === 'sync';
  openOptionsSheet({
    showTono: false, // sin setter de transposición propio en el ctx
    notation: typeof s.ctx.getNotation === 'function' ? s.ctx.getNotation() : 'anglo',
    fontLabel: s.fontScale.toFixed(2),
    autoscrollLabel: speedToPercentLabel(s.speed),
    // VELOCIDAD solo aplica cuando conduce el TimerEngine — en sync el timer
    // nunca conduce (ni siquiera con la pista pausada), así que se oculta
    // apenas se promueve, sin esperar a que la pista suene.
    showAutoscroll: !isSync,
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
    showPlayerToggle: isSync,
    playerOn: isSync && s.audioPlaying,
    onPlayerToggle: (on) => {
      // OFF = pausa del audio (`audio.pause()`), NO una vuelta al TimerEngine
      // — el toggle solo controla reproducción; la degradación a timer es
      // exclusiva de `fallbackToTimer` (error del audio en runtime).
      if (!s.audioEl) return;
      if (on) s.audioEl.play().catch(() => {});
      else s.audioEl.pause();
    },
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
      s.fontScale = Math.max(
        FONT_SCALE_MIN,
        Math.min(FONT_SCALE_MAX, s.fontScale + dir * FONT_SCALE_STEP),
      );
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
    const category =
      (s.song.voiceRoster || []).find((v) => v.id === s.activeVoiceId)?.category ?? null;
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
  let mode = getImmersiveMode();
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
    // Player sincronizado por timings (D3, flag immersive_player): arranca
    // SIEMPRE en 'timer' — la promoción a 'sync' es en caliente tras el
    // await de getSongAudio (maybeLoadSyncAudio), nunca bloquea la entrada.
    engineMode: 'timer',
    // true solo mientras la pista suena (eventos play/pause del <audio>).
    // En sync el timer nunca conduce (esté sonando o pausada la pista) —
    // solo se usa para reflejar el estado de `playerOn` en el sheet.
    audioPlaying: false,
    audioEl: null,
    durationSecHint: null,
    onAudioError: null,
    timingEngine: null,
    timingLines: [],
    timingByLineIndex: new Map(),
    playerListeners: null,
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
  maybeLoadSyncAudio(session);

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
      const idx = Number(lineEl.dataset.i);
      if (session.engineMode === 'sync') seekSyncToLine(session, idx);
      else goTo(session, idx);
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
    if (isVerticalSwipe) {
      adjustSpeed(session, dy < 0 ? GESTURE_SPEED_STEP : -GESTURE_SPEED_STEP);
    } else {
      const idx = session.index + (dx < 0 ? 1 : -1);
      if (session.engineMode === 'sync') seekSyncToLine(session, idx);
      else goTo(session, idx);
    }
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

  // Modo 'tono'/'mixed' sin voz elegida al entrar (p.ej. heredado de
  // layerStore): auto-abre el sheet en la voz, misma paridad que SongView.
  if ((mode === 'tono' || mode === 'mixed') && !activeVoiceId) openOptions(session);
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

  // Player sincronizado (D3): el audio.pause()+src='' pasa por TODOS los
  // caminos de salida, esté o no promovido a sync (cleanupAudioEl es no-op
  // sin audioEl) — sin esto una pista quedaría sonando tras salir.
  // unmountPlayerBar explícito (simetría con fallbackToTimer) en vez de
  // dejarlo implícito en el `overlay.remove()` de más abajo: sus listeners
  // quedan desenganchados del <audio> ANTES de que cleanupAudioEl lo nulee.
  session.timingEngine?.detach();
  if (session.engineMode === 'sync') unmountPlayerBar(session);
  cleanupAudioEl(session);
  removeInterlude(session);

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
