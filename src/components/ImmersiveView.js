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
import { createBeatClock } from '../lib/beatClock.js';
import { createMetronomeClick } from '../lib/metronomeClick.js';
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
import { resolveLabelOverlaps, observeLabelOverlaps } from '../lib/labelOverlap.js';
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
      <span class="imm-v1__bpm" id="imm-bpm-badge" hidden></span>
      <div class="imm-v1__voice-chips" id="imm-voice-chips" hidden></div>
      <button class="imm-v1__btn imm-v1__options" id="imm-open-options" type="button" aria-label="Opciones">${icon('sliders', { size: 18 })}</button>
    </div>
    <div class="imm-v1__pulse" id="imm-pulse" hidden aria-hidden="true"></div>
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

/**
 * dist FIRMADA (i - index): la siguiente línea queda legible, la anterior
 * queda casi nítida (imm-line--prev) y el resto se atenúa progresivamente
 * hacia afuera (patrón roll estilo Apple Music).
 */
function distanceClass(dist) {
  if (dist === 0) return 'imm-line--active';
  if (dist === 1) return 'imm-line--next';
  if (dist === -1) return 'imm-line--prev';
  const d = Math.abs(dist);
  if (d === 2) return 'imm-line--d2';
  if (d === 3) return 'imm-line--d3';
  return 'imm-line--far';
}

// Todas las clases posibles de distanceClass, para limpiarlas antes de re-aplicar.
const DISTANCE_CLASSES = [
  'imm-line--active',
  'imm-line--next',
  'imm-line--prev',
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
  // El rollo se pinta entero de una vez: resuelve colisiones/rebase de
  // etiquetas de acorde/tono sobre TODAS las líneas recién montadas (el
  // observer de resize/fonts se engancha una sola vez en enterImmersive).
  resolveLabelOverlaps(s.els.roll);
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
  if (!cur) return;
  s.els.sectionLabel.textContent = cur.sectionLabel;
  s.els.sectionLabel.className = `imm-v1__section imm-v1__section--${cur.sectionType}`;
}

/**
 * Actualiza la nota disponible del widget híbrido con la de la línea activa
 * para la voz elegida (ciencia, "F#3"). El widget decide solo si la usa
 * (chip "Seguir nota" propio) — aquí solo se alimenta el dato; sin panel
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
  retargetScrollToEl(s, s.lineEls[s.index]);
}

/**
 * Centra el spring sobre `el` (compartido por `retargetScroll` y el estado de
 * pre-roll, que no tiene una línea activa a la que apuntar: `s.lineEls[-1]`
 * no existe, así que apunta al nodo `.imm-interlude`).
 */
function retargetScrollToEl(s, el) {
  if (!el) return;
  const viewportH = s.els.viewport.clientHeight;
  const centerY = el.offsetTop + el.offsetHeight / 2;
  s.spring.setTarget(viewportH * SCROLL_CENTER_RATIO - centerY);
  startScrollLoop(s);
}

/**
 * Estado de pre-roll (índice -1, D6): aún no arrancó la línea 0. Ninguna
 * línea queda activa (línea 0 pasa a `--next` por aritmética de
 * `distanceClass`); el scroll centra el nodo de interludio, no una línea.
 * NO reusa `setActiveIndex` porque esa función clampa a `Math.max(0, ...)`
 * y sus vecinas (`updateSectionLabel`, `renderLineContent`, `retargetScroll`)
 * indexan `s.lines`/`s.lineEls` en `s.index`, que explotaría con -1.
 */
function setPreRoll(s, interludeEl) {
  s.index = -1;
  updateDistanceClasses(s);
  retargetScrollToEl(s, interludeEl);
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
    // `renderLineContent` reemplaza el innerHTML de esas dos líneas (nodos
    // nuevos): el `margin-right`/`data-overlap-fix` de la pasada anterior se
    // pierde, y el ResizeObserver de `observeLabelOverlaps` no cubre este
    // camino de forma garantizada (solo dispara si el tamaño del rollo
    // cambia). Resuelve acotado a las dos líneas repintadas, no todo
    // `s.els.roll` — evita medir cientos de líneas sin cambios en cada avance.
    const prevEl = s.lineEls[prevIndex];
    if (prevEl) resolveLabelOverlaps(prevEl);
    const activeEl = s.lineEls[clamped];
    if (activeEl) resolveLabelOverlaps(activeEl);
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
    promoteToSync(s, audio, timings);
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
function promoteToSync(s, audio, timings) {
  if (s.engineMode === 'sync') return;

  const timingLines = timings.lines;

  const audioEl = document.createElement('audio');
  audioEl.id = 'imm-audio';
  // crossOrigin antes del src: sin esto la respuesta cors del SW (song-audio-v2)
  // llega opaca al <audio> y la reproducción falla con MEDIA_ELEMENT_ERROR (4).
  audioEl.crossOrigin = 'anonymous';
  audioEl.src = audio.url;
  audioEl.preload = 'auto';
  s.audioEl = audioEl;
  s.durationSecHint = Number.isFinite(audio.durationSec) ? audio.durationSec : null;

  s.timingLines = timingLines;
  s.timingByLineIndex = new Map(timingLines.map((l, pos) => [l.i, pos]));
  s.timingEngine = createTimingEngine({
    lines: timingLines,
    // Defensivo (D6): un seek hacia atrás desde una línea intermedia a la
    // zona de pre-roll emitiría onLineChange(-1); timingLines[-1] no existe.
    onLineChange: (pos) => {
      if (pos < 0) return;
      goToSync(s, timingLines[pos].i);
    },
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

  setupMetronome(s, audio, timings);
  mountPlayerBar(s);
  // Aplica el default de mute de la pista (muteada) y sincroniza botón + sheet.
  setTrackMuted(s, s.trackMuted);
  // Aplica el estado inicial de los dos toggles (F4/TANDA B split): audio
  // (mutea/desmutea el click) y visual (pulso/badge/count-in), cada uno
  // reflejado en su control. No-op si esta canción no tiene beats (`s.beatClock` null).
  if (s.beatClock) {
    setMetronomeAudioOn(s, s.metronomeAudioOn);
    setMetronomeVisualOn(s, s.metronomeVisualOn);
  }
}

/**
 * Deriva rejilla+reloj de beats de `timings.beats` (D3, endpoint expone
 * beats + overrides de bpm/compas/ancla) y prepara contenido del badge BPM +
 * pulso visual (guarda `s.hasBpmBadge` para el caso sin-BPM). NO decide
 * visibilidad — eso es responsabilidad exclusiva de `setMetronomeAudioOn`/
 * `setMetronomeVisualOn` (toggles split, TANDA B), llamados después de montar. Sin beats (canción sin
 * beat-tracking o audio de reproceso) es un no-op: el badge y el pulso quedan
 * `hidden`, como al entrar. Se llama ANTES de `mountPlayerBar` para que su
 * plantilla pueda decidir si pinta el toggle rápido del click según `s.beatClock`.
 */
function setupMetronome(s, audio, timings) {
  if (!Array.isArray(timings.beats) || timings.beats.length === 0) return;

  const bpm = audio.bpmManual ?? timings.bpmDetected;
  const timeSignature = audio.timeSignature ?? '4/4';
  const beatAnchor = audio.beatAnchor ?? 1;

  s.beatClock = createBeatClock({ beatsMs: timings.beats, timeSignature, beatAnchor });
  s.metronome = createMetronomeClick({
    clock: s.beatClock,
    getTimeMs: () => s.audioEl.currentTime * 1000,
  });

  s.hasBpmBadge = bpm !== null && bpm !== undefined;
  if (s.hasBpmBadge) {
    s.els.bpmBadge.textContent = `${Math.round(bpm)} BPM · ${timeSignature}`;
  }

  s.els.pulse.innerHTML = Array.from(
    { length: s.beatClock.perBar },
    () => '<span class="imm-v1__pulse-dot"></span>',
  ).join('');
}

/** rAF que resalta el dot del beat actual mientras suena la pista (solo con beatClock). */
function startPulseLoop(s) {
  if (!s.beatClock || s.beatRafId !== null) return;
  const dots = s.els.pulse.querySelectorAll('.imm-v1__pulse-dot');
  const loop = () => {
    const { beatInBar } = s.beatClock.at(s.audioEl.currentTime * 1000);
    dots.forEach((dot, i) => {
      const active = beatInBar === i + 1;
      dot.classList.toggle('is-active', active);
      dot.classList.toggle('is-accent', active && beatInBar === 1);
    });
    s.beatRafId = requestAnimationFrame(loop);
  };
  s.beatRafId = requestAnimationFrame(loop);
}

function stopPulseLoop(s) {
  if (s.beatRafId !== null) cancelAnimationFrame(s.beatRafId);
  s.beatRafId = null;
}

/**
 * Toggle de AUDIO del metrónomo (F4/TANDA B split): `on` desmutea/mutea SOLO
 * el click audible (`s.metronome.setMuted`). NUNCA toca pulso/badge/count-in
 * (eso es `setMetronomeVisualOn`) ni destruye `s.metronome`. Refleja el estado
 * en el botón rápido de la barra (que controla el audio) y en el sheet.
 */
function setMetronomeAudioOn(s, on) {
  s.metronomeAudioOn = on;
  s.metronome?.setMuted(!on);
  const quickBtn = s.els.overlay.querySelector('#imm-metronome-toggle');
  if (quickBtn) {
    quickBtn.setAttribute('aria-pressed', String(on));
    quickBtn.innerHTML = icon(on ? 'timer' : 'timer-off', { size: 18 });
  }
  refreshOptionsSheet(s);
}

/**
 * Toggle VISUAL del metrónomo (F4/TANDA B split): `on` muestra/oculta la guía
 * visual completa — pulso, badge de BPM (respetando `s.hasBpmBadge`), el pulse
 * loop rAF y el count-in del interludio (guard `s.metronomeVisualOn` en
 * `showInterlude`). No toca el click audible (eso es `setMetronomeAudioOn`) ni
 * destruye `s.beatClock`: re-encender restaura todo en caliente.
 */
function setMetronomeVisualOn(s, on) {
  s.metronomeVisualOn = on;
  s.els.pulse.hidden = !on || !s.beatClock;
  s.els.bpmBadge.hidden = !on || !s.beatClock || !s.hasBpmBadge;
  if (on && s.audioPlaying) startPulseLoop(s);
  else stopPulseLoop(s);
  refreshOptionsSheet(s);
}

/** Cae en caliente de TimingEngine a TimerEngine (p.ej. error del `<audio>`), sin salir de la vista. */
function fallbackToTimer(s) {
  if (s.engineMode !== 'sync') return;
  s.timingEngine?.detach();
  s.timingEngine = null;
  s.timingLines = [];
  s.timingByLineIndex = new Map();
  s.metronome?.stop();
  stopPulseLoop(s);
  s.beatClock = null;
  s.metronome = null;
  s.metronomeAudioOn = false;
  s.metronomeVisualOn = false;
  s.els.pulse.hidden = true;
  s.els.bpmBadge.hidden = true;
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

/** Pausa + vacía + desengancha el `<audio>` (todos los caminos de salida/degradación pasan por aquí). */
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

/**
 * Fuente única del mute de la pista: aplica `muted` al `<audio>` y refleja el
 * estado en el botón de altavoz de la barra (`#imm-player-mute`) y en el sheet.
 * Independiente del click del metrónomo (Web Audio, `setMetronomeAudioOn`):
 * mutear la pista no silencia el click ni al revés.
 */
function setTrackMuted(s, muted) {
  s.trackMuted = muted;
  if (s.audioEl) s.audioEl.muted = muted;
  const muteBtn = s.els.overlay.querySelector('#imm-player-mute');
  if (muteBtn) {
    muteBtn.innerHTML = icon(muted ? 'volume-x' : 'volume-2', { size: 18 });
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? 'Activar sonido de la pista' : 'Silenciar pista');
  }
  refreshOptionsSheet(s);
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
      <button class="imm-player__mute" id="imm-player-mute" type="button" aria-pressed="true" aria-label="Activar sonido de la pista">${icon('volume-x', { size: 18 })}</button>
      ${
        s.beatClock
          ? `<button class="imm-v1__btn imm-v1__metronome-toggle" id="imm-metronome-toggle" type="button" aria-pressed="false" aria-label="Sonido del metrónomo">${icon('timer-off', { size: 18 })}</button>`
          : ''
      }
    </div>`;
  slot.appendChild(s.audioEl);

  const playBtn = slot.querySelector('#imm-player-play');
  const scrubber = slot.querySelector('#imm-player-scrubber');
  const timeEl = slot.querySelector('#imm-player-time');
  const durEl = slot.querySelector('#imm-player-duration');
  const muteBtn = slot.querySelector('#imm-player-mute');
  const metronomeBtn = slot.querySelector('#imm-metronome-toggle');

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
    // Gátéalo al toggle VISUAL del metrónomo (split): con la guía visual
    // apagada no debe quedar un rAF corriendo aunque la pista suene;
    // setMetronomeVisualOn ya arranca el loop si se enciende mientras suena.
    if (s.metronomeVisualOn) startPulseLoop(s);
    refreshOptionsSheet(s);
  };
  const onPause = () => {
    s.audioPlaying = false;
    s.paused = true;
    s.els.overlay.classList.add('imm-v1--paused');
    playBtn.innerHTML = icon('play', { size: 18 });
    playBtn.setAttribute('aria-label', 'Reproducir pista');
    showControls(s);
    stopPulseLoop(s);
    refreshOptionsSheet(s);
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
  // audio, solo deja de sonar). Delegado a `setTrackMuted`, fuente única del
  // mute de la pista (sincroniza también el sheet).
  const onMuteBtnClick = () => setTrackMuted(s, !s.trackMuted);

  // Toggle rápido del metrónomo (F4/TANDA B split): controla el SONIDO/click,
  // arranca según `s.metronomeAudioOn` (default apagado — ver estado inicial
  // de la sesión), un solo clic alterna el audio sin pasar por el sheet —
  // mismo estado que refleja "Sonido" en Opciones.
  const onMetronomeBtnClick = () => setMetronomeAudioOn(s, !s.metronomeAudioOn);
  metronomeBtn?.addEventListener('click', onMetronomeBtnClick);

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
    onMetronomeBtnClick,
    playBtn,
    scrubber,
    muteBtn,
    metronomeBtn,
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
    l.metronomeBtn?.removeEventListener('click', l.onMetronomeBtnClick);
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
 *
 * `index === -1` es el caso de pre-roll (D6, contrato de `timingEngine`):
 * aún no arrancó la línea 0, así que el nodo va ANTES de `lineEls[0]` (no
 * hay `lineEls[-1]` tras el cual insertarlo) y el roll pasa a estado
 * pre-roll (`setPreRoll`) en vez de repintar una línea activa.
 */
function showInterlude(s, { index, progress }) {
  if (s.engineMode !== 'sync') return;

  // Count-in por beats (F4/D6): con rejilla de beats, en el último compás
  // antes de la línea (1 <= beats restantes <= perBar) se cuenta hacia atrás
  // en vez de puntitos — referencia más útil justo antes de que entre la
  // voz; fuera de ese último compás (intro larga o hueco grande) puntitos de
  // progreso alcanzan y evitan un número engañosamente alto. Sin beatClock
  // (sin beat-tracking en esta canción) se conserva el comportamiento de
  // puntitos original.
  let remainingBeats = null;
  const nextLine = s.timingLines[index + 1];
  if (s.beatClock && nextLine) {
    remainingBeats = s.beatClock.beatsUntil(s.audioEl.currentTime * 1000, nextLine.startMs);
  }
  const perBar = s.beatClock?.perBar ?? 4;
  const showCount =
    s.metronomeVisualOn &&
    remainingBeats !== null &&
    remainingBeats >= 1 &&
    remainingBeats <= perBar;

  let el = s.els.roll.querySelector('.imm-interlude');
  if (!el || el.dataset.after !== String(index)) {
    removeInterlude(s);
    el = document.createElement('div');
    el.className = 'imm-interlude';
    el.dataset.after = String(index);
    if (index === -1) {
      const firstEl = s.lineEls[0];
      if (firstEl) firstEl.insertAdjacentElement('beforebegin', el);
      else s.els.roll.appendChild(el);
      setPreRoll(s, el);
    } else {
      const afterEl = s.lineEls[index];
      if (afterEl) afterEl.insertAdjacentElement('afterend', el);
      else s.els.roll.appendChild(el);
    }
  }

  if (showCount) {
    if (!el.querySelector('.imm-interlude__count')) {
      el.innerHTML = '<span class="imm-interlude__count"></span>';
    }
    el.querySelector('.imm-interlude__count').textContent = String(Math.ceil(remainingBeats));
    return;
  }

  if (!el.querySelector('.imm-interlude__dot')) {
    el.innerHTML =
      '<span class="imm-interlude__dot"></span><span class="imm-interlude__dot"></span><span class="imm-interlude__dot"></span>';
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
  refreshOptionsSheet(s);
}

// ── SHEET DE OPCIONES ─────────────────────────────────────────────────────

/** Con el sheet abierto, lo re-renderiza contra el estado actual de `s`; cerrado, no-op (nunca lo abre). */
function refreshOptionsSheet(s) {
  if (isOptionsSheetOpen()) openOptions(s);
}

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
    showTrackSound: isSync,
    trackSoundOn: isSync && !s.trackMuted,
    onTrackSoundToggle: (on) => setTrackMuted(s, !on),
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
    showMetronome: !!s.beatClock,
    metronomeAudioOn: s.metronomeAudioOn,
    metronomeVisualOn: s.metronomeVisualOn,
    onMetronomeAudioToggle: (on) => setMetronomeAudioOn(s, on),
    onMetronomeVisualToggle: (on) => setMetronomeVisualOn(s, on),
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
        refreshOptionsSheet(s);
      },
    });
  } else {
    s.floatingTuner?.destroy();
    s.floatingTuner = null;
  }
  refreshOptionsSheet(s);
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
    bpmBadge: overlay.querySelector('#imm-bpm-badge'),
    pulse: overlay.querySelector('#imm-pulse'),
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
    // Metrónomo (F4): reloj de beats derivado de timings.beats (D3), solo
    // existe tras promoteToSync con beats disponibles.
    beatClock: null,
    beatRafId: null,
    metronome: null,
    hasBpmBadge: false,
    // Metrónomo (F4/TANDA B split): dos toggles independientes. Default audio
    // OFF (click muteado) + visual ON (badge/pulso/count-in visibles), = el
    // comportamiento pre-toggle-maestro. El click igual solo suena con la pista sonando.
    metronomeAudioOn: false,
    metronomeVisualOn: true,
    // Pista muteada por default al entrar (spec: ambos audios silenciados al
    // entrar; el usuario desmutea pista y/o click por separado). Solo aplica en
    // sync (donde existe el <audio>); en timer no hay pista.
    trackMuted: true,
    // Anti-colisión de etiquetas: un solo observer sobre el rollo, montado
    // aquí y desconectado en exitImmersive (mismo ciclo de vida que el resto
    // de listeners de la sesión).
    disconnectLabelOverlaps: null,
  };

  const activeCategory =
    (ctx.song.voiceRoster || []).find((v) => v.id === activeVoiceId)?.category ?? null;
  els.voiceChips.innerHTML = renderVoiceChips(ctx.song, activeCategory);
  updateVoiceChipsVisibility(session);

  renderRoll(session);
  session.disconnectLabelOverlaps = observeLabelOverlaps(els.roll);
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
  session.disconnectLabelOverlaps?.();

  // Player sincronizado (D3): el audio.pause()+src='' pasa por TODOS los
  // caminos de salida, esté o no promovido a sync (cleanupAudioEl es no-op
  // sin audioEl) — sin esto una pista quedaría sonando tras salir.
  // unmountPlayerBar explícito (simetría con fallbackToTimer) en vez de
  // dejarlo implícito en el `overlay.remove()` de más abajo: sus listeners
  // quedan desenganchados del <audio> ANTES de que cleanupAudioEl lo nulee.
  session.timingEngine?.detach();
  session.metronome?.stop();
  stopPulseLoop(session);
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
