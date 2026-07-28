/**
 * Tuner.js — Afinador beta (voz, guitarra, modo canción, medición rango).
 *
 * Four modes share one mic-stream + YIN pitch detector:
 *   - guitar: 6-string E-standard tuner with cents gauge
 *   - voice:  any-note tuner with cents gauge
 *   - song:   "Cantá con la canción" — validates note against `song.key`
 *   - range:  guided 2-step measurement saved to profile vocal_range_low/high
 *
 * Audio is processed in-memory only — no upload, no persistence of audio.
 */

import '../styles/tuner.css';
import { createPitchDetector, shouldAutoStartMic } from '../lib/pitch.js';
import { createPitchStabilizer } from '../lib/pitchStabilizer.js';
import {
  frequencyToNote,
  noteToFrequency,
  nearestString,
  getScaleNotes,
  GUITAR_STANDARD,
  parseTunerTarget,
  matchesTarget,
  centsBetween,
} from '../lib/notes.js';
import { fetchSongDetail } from '../lib/store.js';
import { getSession, refreshProfile, getProfile } from '../lib/authStore.js';
import { invalidateMyProfile } from '../lib/profileCache.js';
import { navigate, onRouteChange } from '../router.js';
import { icon } from '../lib/icons.js';
import { showToast } from '../lib/toast.js';
import {
  getCalibrationCents,
  applyCalibration,
  setCalibrationCents,
  centsToA4,
  a4ToCents,
} from '../lib/calibration.js';
import { runLoopbackTest } from '../lib/loopbackTest.js';
import { createTonePlayer } from '../lib/tonePlayer.js';
import { buildScaleSequence, pickStartOctave, EXERCISE_PRESETS } from '../lib/scales.js';
import { buildWarmup } from '../lib/warmup.js';
import { createExercise } from '../lib/exerciseEngine.js';
import { get, set } from 'idb-keyval';
import { createMetronome, TIME_SIGNATURES, DEFAULT_BPM } from '../lib/metronome.js';
import { centsToBarPercent } from '../lib/tunerGauge.js';
import { colorFromCents } from '../lib/tunerWidget.js';

/** Formatea un valor de cents con signo explícito: "+5¢", "-3¢", "0¢". */
const fmtCents = (c) => `${c > 0 ? '+' : ''}${c}¢`;

/** IDs de modo válidos (usados para validar `?mode=` y las tiles del hub). */
const MODES = ['guitar', 'voice', 'song', 'range', 'calibrar', 'entrenar', 'metronomo'];

/** Modos que necesitan micrófono activo apenas se entra a ellos (auto-start). */
const MIC_MODES = new Set(['guitar', 'voice', 'song', 'range', 'entrenar']);

/** Hub (Opción C): tiles agrupadas por bloque, tinte teal, one-liner corto. */
const HUB_GROUPS = [
  {
    label: 'Afinar',
    items: [
      { id: 'guitar', iconKey: 'audio-lines', name: 'Guitarra', desc: 'Afina las 6 cuerdas en estándar E.' },
      { id: 'voice', iconKey: 'mic', name: 'Voz', desc: 'Afina tu voz nota por nota.' },
      { id: 'song', iconKey: 'music', name: 'Canción', desc: 'Afina contra el tono de una canción.' },
    ],
  },
  {
    label: 'Practicar',
    items: [
      { id: 'range', iconKey: 'ruler', name: 'Rango', desc: 'Mide tu nota más grave y más aguda.' },
      { id: 'entrenar', iconKey: 'activity', name: 'Entrenar', desc: 'Ejercicios de escalas y calentamiento.' },
      { id: 'metronomo', iconKey: 'timer', name: 'Metrónomo', desc: 'Practica manteniendo el tempo.' },
    ],
  },
  {
    label: 'Ajustes',
    items: [
      { id: 'calibrar', iconKey: 'settings', name: 'Calibrar', desc: 'Ajusta la referencia A4 de tu dispositivo.' },
    ],
  },
];

/** Título que muestra la cabecera al entrar a cada modo enfocado. */
const MODE_TITLES = {
  guitar: 'Guitarra',
  voice: 'Voz',
  song: 'Canción',
  range: 'Rango',
  entrenar: 'Entrenamiento',
  metronomo: 'Metrónomo',
  calibrar: 'Calibrar',
};

const RANGE_STEP_MS = 10000;
const RANGE_RING_R = 36;
const RANGE_RING_CIRCUMFERENCE = 2 * Math.PI * RANGE_RING_R;

function parseQuery(query) {
  const out = {};
  if (!query) return out;
  for (const part of query.split('&')) {
    const [k, v] = part.split('=');
    out[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return out;
}

function renderGauge() {
  // Barra lineal horizontal (ancho completo). Zonas fijas sobre una escala
  // 0..100% donde 0¢ = 50% (centro): ok=±10¢ (40–60%), warn=±10–30¢
  // (20–40% / 60–80%), danger=>±30¢ (0–20% / 80–100%). El indicador se
  // posiciona en runtime con centsToBarPercent() vía setNeedle().
  return `
    <div class="tuner-gauge" aria-hidden="true">
      <div class="tuner-gauge__track">
        <div class="tuner-gauge__zone tuner-gauge__zone--danger tuner-gauge__zone--danger-left"></div>
        <div class="tuner-gauge__zone tuner-gauge__zone--warn tuner-gauge__zone--warn-left"></div>
        <div class="tuner-gauge__zone tuner-gauge__zone--ok"></div>
        <div class="tuner-gauge__zone tuner-gauge__zone--warn tuner-gauge__zone--warn-right"></div>
        <div class="tuner-gauge__zone tuner-gauge__zone--danger tuner-gauge__zone--danger-right"></div>
        <div class="tuner-gauge__center-mark"></div>
        <div id="tuner-needle" class="tuner-gauge__indicator" data-status="" style="left: 50%"></div>
      </div>
      <div class="tuner-gauge__scale">
        <span>−50</span><span>−10</span><span>0</span><span>+10</span><span>+50</span>
      </div>
    </div>
  `;
}

function setNeedle(container, cents, statusClass) {
  const indicator = container.querySelector('#tuner-needle');
  if (!indicator) return;
  indicator.style.left = `${centsToBarPercent(cents)}%`;
  indicator.dataset.status = statusClass || '';
}

function renderReadout(container, { label, hz, cents, sub }) {
  const el = container.querySelector('#tuner-readout');
  if (!el) return;
  const hzText = hz === null || hz === undefined ? '— Hz' : `${hz.toFixed(1)} Hz`;
  const centsText = cents === null || cents === undefined ? '—¢' : fmtCents(cents);
  el.innerHTML = `
    <div class="tuner-readout__note">${label ?? '—'}</div>
    <div class="tuner-readout__meta">
      ${hzText}
      <span class="tuner-readout__sep">·</span>
      ${centsText}
    </div>
    ${sub ? `<div class="tuner-readout__sub">${sub}</div>` : ''}
  `;
  el.dataset.status = cents === null || cents === undefined ? '' : colorFromCents(cents);
}

/* ─── Mode body renderers ─── */

function bodyGuitarOrVoice(mode, targetNote) {
  const list =
    mode === 'guitar'
      ? `<ul class="tuner-strings" id="tuner-strings">
           ${GUITAR_STANDARD.map(
             (s) => `<li class="tuner-strings__item" data-string="${s}">${s}</li>`,
           ).join('')}
         </ul>`
      : '';
  const objective =
    mode === 'voice' && targetNote
      ? `<p class="tuner-objective" id="tuner-objective">Objetivo: <strong>${targetNote}</strong><span class="tuner-objective__check" aria-hidden="true">${icon('check-circle', { size: 18 })}</span></p>`
      : '';
  return `
    ${objective}
    ${list}
    <div class="tuner-readout" id="tuner-readout" data-status="">
      <div class="tuner-readout__note">—</div>
      <div class="tuner-readout__meta">— Hz · —¢</div>
    </div>
    ${renderGauge()}
    <p class="tuner-hint">${
      mode === 'guitar'
        ? 'Toca una cuerda. Se resalta la nota objetivo más cercana.'
        : targetNote
          ? `Canta ${targetNote} sostenida. Se pone en verde cuando coincide.`
          : 'Canta una nota sostenida.'
    }</p>
  `;
}

/**
 * Render the "Canción" tab body.
 * @param {{ title: string, key?: string }} song - Song data.
 * @param {string|null} [targetLabel] - Optional target note label (e.g. "D3"). When provided,
 *   shows an "Objetivo" callout and marks the matching scale `<li>` with `data-target="true"`.
 * @returns {string} HTML string.
 */
export function bodySong(song, targetLabel = null) {
  // v1/v2: tonalidad explícita de canción → escala completa + (opcional) objetivo.
  if (song?.key) {
    const scale = getScaleNotes(song.key);
    // pitch-class del objetivo = label sin la octava final (D3 -> D, F#3 -> F#).
    const targetPc = targetLabel ? targetLabel.replace(/\d+$/, '') : null;
    const objective = targetLabel
      ? `<p class="tuner-objective" id="tuner-objective">Objetivo de tu voz: <strong>${targetLabel}</strong></p>`
      : '';
    return `
      <div class="tuner-song">
        <h2 class="tuner-song__title">${song.title}</h2>
        <p class="tuner-song__key">Tono: <strong>${song.key}</strong></p>
        ${objective}
        <ul class="tuner-scale" id="tuner-scale">
          ${scale
            .map(
              (n) => `<li data-pc="${n}"${n === targetPc ? ' data-target="true"' : ''}>${n}</li>`,
            )
            .join('')}
      </ul>
      </div>
      <div class="tuner-readout" id="tuner-readout" data-status="">
        <div class="tuner-readout__note">—</div>
        <div class="tuner-readout__meta">— Hz · —¢</div>
      </div>
      ${renderGauge()}
      <p class="tuner-hint">${
        targetLabel
          ? `Canta <strong>${targetLabel}</strong>. Se pone verde al coincidir. Verde claro = nota en escala de ${song.key}.`
          : `Verde = la nota pertenece a <em>${song.key}</em>. Rojo = fuera de escala.`
      }</p>
    `;
  }

  // v3: la canción no tiene tono propio, pero la voz trae su nota de referencia
  // (`ref` → targetLabel). Afinamos contra esa nota (sin escala — v3 es por voz).
  if (targetLabel) {
    return `
      <div class="tuner-song">
        <h2 class="tuner-song__title">${song?.title ?? ''}</h2>
        <p class="tuner-objective" id="tuner-objective">Tu nota de referencia: <strong>${targetLabel}</strong></p>
      </div>
      <div class="tuner-readout" id="tuner-readout" data-status="">
        <div class="tuner-readout__note">—</div>
        <div class="tuner-readout__meta">— Hz · —¢</div>
      </div>
      ${renderGauge()}
      <p class="tuner-hint">Canta <strong>${targetLabel}</strong> sostenida. Se pone verde al coincidir.</p>
    `;
  }

  // Sin tono y sin nota objetivo: no hay nada contra qué afinar.
  return `
    <div class="tuner-empty">
      <p>Esta canción no tiene notas asignadas todavía.</p>
      <p>Pide al admin que configure las voces y el tono en el editor.</p>
    </div>
  `;
}

function bodyRange(step, currentNote) {
  const label = step === 'low' ? 'TU NOTA MÁS GRAVE' : 'TU NOTA MÁS AGUDA';
  const stepNum = step === 'low' ? '1' : '2';
  return `
    <div class="tuner-range">
      <div class="tuner-range__step">Paso ${stepNum} / 2</div>
      <h2 class="tuner-range__title">${label}</h2>
      <p class="tuner-range__hint">
        Canta sostenida durante <strong>10 segundos</strong>.
      </p>

      <div class="tuner-readout" id="tuner-readout" data-status="">
        <div class="tuner-readout__note">${currentNote || '—'}</div>
        <div class="tuner-readout__meta">— Hz · —¢</div>
      </div>

      <div class="tuner-progress">
        <svg class="tuner-progress__ring" viewBox="0 0 80 80" width="80" height="80" role="img" aria-label="Progreso de la medicion">
          <circle class="tuner-progress__ring-track" cx="40" cy="40" r="${RANGE_RING_R}" />
          <circle
            class="tuner-progress__ring-fill"
            id="tuner-progress-ring"
            cx="40"
            cy="40"
            r="${RANGE_RING_R}"
            stroke-dasharray="${RANGE_RING_CIRCUMFERENCE}"
            stroke-dashoffset="${RANGE_RING_CIRCUMFERENCE}"
          />
        </svg>
      </div>
      <div class="tuner-progress__label" id="tuner-progress-label">0 / 10s</div>

      <div class="tuner-range__actions">
        <button class="btn btn--secondary" id="range-cancel">Cancelar</button>
        <button class="btn btn--primary" id="range-start">Empezar</button>
      </div>
    </div>
  `;
}

const FREE_NOTE_KEY = 'hkn-tuner-free-note';
const FREE_PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FREE_OCT_MIN = 1;
const FREE_OCT_MAX = 6;

/**
 * Valida una nota libre del afinador (sharps canónicos, octavas 1-6).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function sanitizeFreeNote(raw) {
  return typeof raw === 'string' && /^[A-G]#?[1-6]$/.test(raw) ? raw : null;
}

/**
 * Picker de nota libre (pestaña Canción sin canción): 12 chips de pitch-class
 * + stepper de octava + CTA. Render puro (string) para testear sin DOM.
 * @param {{ pc: string, octave: number }} pick
 * @returns {string}
 */
export function bodyFreeNote(pick) {
  const label = `${pick.pc}${pick.octave}`;
  const hz = noteToFrequency(label);
  return `
    <div class="tuner-free">
      <p class="tuner-free__hint">Elige la nota que quieres afinar</p>
      <div class="tuner-free__grid" role="group" aria-label="Nota">
        ${FREE_PCS.map(
          (pc) =>
            `<button class="tuner-free__pc" data-pc="${pc}" data-active="${pc === pick.pc}">${pc}</button>`,
        ).join('')}
      </div>
      <div class="tuner-free__oct">
        <button class="tuner-free__oct-btn" id="free-oct-down" aria-label="Octava más grave">−</button>
        <span class="tuner-free__oct-val">Octava ${pick.octave}</span>
        <button class="tuner-free__oct-btn" id="free-oct-up" aria-label="Octava más aguda">+</button>
      </div>
      <div class="tuner-free__note">${label}</div>
      <p class="tuner-free__sub">Tu nota de referencia · ${hz.toFixed(1)} Hz</p>
      <button class="btn btn--primary tuner-free__cta" id="free-tune">${icon('mic', { size: 15 })} Afinar ${label}</button>
    </div>
  `;
}

/**
 * Cuerpo del modo Calibrar: auto-test de loopback + control manual de A4.
 * Render puro (string) para testear sin DOM.
 * @param {{ calCents: number }} state
 * @returns {string}
 */
export function bodyCalibrar({ calCents }) {
  const a4 = Math.round(centsToA4(calCents));
  return `
    <div class="tuner-cal">
      <p class="tuner-cal__hint">
        ${icon('info', { size: 14 })} Usa un <strong>altavoz</strong> (no audífonos) para el auto-test.
      </p>
      <div class="tuner-cal__current">Ajuste actual: <strong id="cal-current">${fmtCents(calCents)}</strong></div>
      <button class="btn btn--primary" id="cal-run">${icon('activity', { size: 14 })} Probar afinador</button>
      <div class="tuner-cal__result" id="cal-result" aria-live="polite"></div>

      <div class="tuner-cal__manual">
        <label for="cal-a4">A4 de referencia: <strong id="cal-a4-val">${a4} Hz</strong></label>
        <input type="range" id="cal-a4" min="415" max="466" step="1" value="${a4}" />
        <button class="btn btn--secondary btn--sm" id="cal-reset">Restablecer (440 Hz)</button>
      </div>
    </div>
  `;
}

/**
 * Picker inicial del modo Entrenar: calentamiento por rango o ejercicio de escala.
 * Render puro (string) para testear sin DOM.
 * @returns {string}
 */
export function bodyEntrenarPicker() {
  const presets = EXERCISE_PRESETS.map(
    (p) => `<button class="tuner-train__preset" data-preset="${p.id}">${p.label}</button>`,
  ).join('');
  return `
    <div class="tuner-train">
      <p class="tuner-train__hint">Elige un entrenamiento</p>
      <button class="btn btn--primary tuner-train__warmup" data-train="warmup">
        ${icon('flame', { size: 15 })} Calentamiento por mi rango
      </button>
      <div class="tuner-train__divider">o ejercicio de escala</div>
      <div class="tuner-train__presets" role="group" aria-label="Escalas">
        ${presets}
      </div>
      <label class="tuner-train__fit">
        <input type="checkbox" id="train-fit-range" />
        <span class="tuner-train__fit-text">
          <span class="tuner-train__fit-title">Ajustar la escala a mi rango</span>
          <span class="tuner-train__fit-desc">Transpone el ejercicio para que entre en tu tesitura.</span>
        </span>
      </label>
    </div>
  `;
}

/* ─── Modo Metrónomo ─── */

function bodyMetronomo({ bpm, signature, running }) {
  const sigs = Object.keys(TIME_SIGNATURES); // ['4/4','3/4','2/4','6/8']
  const beats = TIME_SIGNATURES[signature].beats;
  const dots = Array.from(
    { length: beats },
    (_, i) =>
      `<span class="metro-dot${TIME_SIGNATURES[signature].accents.includes(i) ? ' metro-dot--accent' : ''}" data-beat="${i}"></span>`,
  ).join('');
  return `
    <div class="metro" role="group" aria-label="Metrónomo">
      <div class="metro-bpm">
        <button class="metro-step" id="metro-down" aria-label="Bajar BPM">${icon('chevron-down', { size: 22 })}</button>
        <div class="metro-bpm__val"><span id="metro-bpm-num">${bpm}</span><small>BPM</small></div>
        <button class="metro-step" id="metro-up" aria-label="Subir BPM">${icon('chevron-up', { size: 22 })}</button>
      </div>

      <div class="metro-sig" role="tablist" aria-label="Compás">
        ${sigs
          .map(
            (s) =>
              `<button class="metro-sig__btn" data-sig="${s}" aria-selected="${s === signature}">${s}</button>`,
          )
          .join('')}
      </div>

      <div
        class="metro-pendulum"
        id="metro-pendulum"
        data-running="${running}"
        style="--metro-pendulum-duration: ${Math.round(120000 / bpm)}ms"
        aria-hidden="true"
      >
        <div class="metro-pendulum__arm"></div>
      </div>

      <div class="metro-beats" id="metro-beats" aria-hidden="true">${dots}</div>
      <div class="metro-count" id="metro-count" aria-live="off">—</div>

      <div class="metro-actions">
        <button class="btn btn--primary metro-play" id="metro-play">${running ? 'Detener' : 'Iniciar'}</button>
        <button class="btn btn--secondary metro-tap" id="metro-tap">Tap</button>
      </div>
    </div>
  `;
}

/* ─── Mic permission gate ─── */

function bodyPermissionGate(state) {
  if (state === 'denied') {
    return `
      <div class="tuner-perm">
        <div class="tuner-perm__icon">${icon('mic-off', { size: 32 })}</div>
        <p>Micrófono bloqueado.</p>
        <p>Habilita el micrófono en los permisos del sitio para usar el afinador.</p>
      </div>
    `;
  }
  return `
    <div class="tuner-perm">
      <div class="tuner-perm__icon">${icon('mic-off', { size: 32 })}</div>
      <p>Necesito acceso al micrófono para detectar el tono.</p>
      <button class="tuner-perm__btn" id="tuner-grant">
        ${icon('mic', { size: 15 })} Activar micrófono
      </button>
    </div>
  `;
}

/* ─── Hub (landing agrupada) ─── */

function renderHub() {
  return `
    <div class="tuner-hub">
      ${HUB_GROUPS.map(
        (group) => `
          <section class="tuner-hub__group">
            <h2 class="tuner-hub__label">${group.label}</h2>
            <div class="tuner-hub__grid">
              ${group.items
                .map(
                  (it) => `
                    <button class="tuner-hub__tile" data-mode="${it.id}">
                      <span class="tuner-hub__plate">${icon(it.iconKey, { size: 20 })}</span>
                      <span class="tuner-hub__text">
                        <span class="tuner-hub__name">${it.name}</span>
                        <span class="tuner-hub__desc">${it.desc}</span>
                      </span>
                      ${icon('chevron-right', { size: 18, className: 'tuner-hub__arrow' })}
                    </button>
                  `,
                )
                .join('')}
            </div>
          </section>
        `,
      ).join('')}
    </div>
  `;
}

/* ─── Main ─── */

/**
 * @param {HTMLElement} container
 * @param {{ query?: string }} [opts]
 */
export async function renderTuner(container, opts = {}) {
  const params = parseQuery(opts.query);
  const target = parseTunerTarget(params);
  // Sin ?mode= ni objetivo de canción: aterriza en el hub (mode = null).
  // Con ?mode= válido o un objetivo de voz (shortcut desde canción): entra
  // directo al modo enfocado, saltando el hub.
  const defaultMode = target.note ? 'voice' : null;
  let mode = params.mode && MODES.includes(params.mode) ? params.mode : defaultMode;
  const songId = params.songId || null;

  // Canonical (sharp-spelled) target so it matches frequencyToNote output,
  // e.g. an incoming "Bb5" becomes { note: 'A#', octave: 5 }.
  let targetCanonical = target.note ? frequencyToNote(noteToFrequency(target.note)) : null;
  let targetLabel = targetCanonical ? `${targetCanonical.note}${targetCanonical.octave}` : null;
  let song = null;
  if (mode === 'song' && songId) {
    song = await fetchSongDetail(songId).catch(() => null);
  }

  /** @type {ReturnType<typeof createPitchDetector> | null} */
  let detector = null;
  const stabilizer = createPitchStabilizer();
  let micState = 'idle'; // 'idle' | 'requesting' | 'running' | 'denied' | 'stopped'
  let capturePitch = null; // hook temporal para el auto-test de calibración
  // Fix 1: player único para el test de calibrar; createTonePlayer no abre el
  // AudioContext hasta el primer play(), así que es barato crearlo aquí.
  const calPlayer = createTonePlayer({});
  // Range-mode state
  let rangeStep = 'low';
  let rangeTempLow = null;
  let rangeTempHigh = null;
  let rangeTimerId = null;
  let rangeStartMs = 0;
  let rangeSamples = [];
  // Estado del modo Entrenar.
  let exercise = null; // ReturnType<typeof createExercise> | null
  let exerciseDone = false;
  const tonePlayer = createTonePlayer({});

  // Estado del modo Metrónomo.
  let metronome = null; // ReturnType<typeof createMetronome> | null
  let metroSig = '4/4';
  let metroRaf = null; // id de requestAnimationFrame del loop visual
  let metroQueue = []; // cola {beat, time} para sincronizar el visual al audio
  let metroHoldTimer = null; // timer de hold-to-repeat en las flechas

  async function ensureMetronome() {
    if (metronome) return metronome;
    metronome = createMetronome({
      onBeat: (beat, _accent, time) => metroQueue.push({ beat, time }),
    });
    // Restaurar BPM + compás persistidos.
    try {
      const saved = await get('tuner:metronome');
      if (saved && typeof saved === 'object') {
        if (saved.bpm) metronome.setBpm(saved.bpm);
        if (saved.signature && TIME_SIGNATURES[saved.signature]) {
          metroSig = saved.signature;
          metronome.setSignature(metroSig);
        }
      }
    } catch (_e) {
      /* idb no disponible: defaults */
    }
    return metronome;
  }

  function persistMetronome() {
    if (!metronome) return;
    set('tuner:metronome', { bpm: metronome.getBpm(), signature: metroSig }).catch(() => {});
  }

  function stopMetroVisual() {
    if (metroRaf !== null) {
      cancelAnimationFrame(metroRaf);
      metroRaf = null;
    }
    metroQueue = [];
  }

  function startExercise(sequence) {
    if (!sequence || sequence.length === 0) {
      alert('No pude armar el ejercicio. Configura tu rango en el perfil.');
      return;
    }
    exercise = createExercise({ sequence, holdFrames: 8 });
    exerciseDone = false;
    paintBody();
    const first = exercise.current();
    if (first) tonePlayer.play(noteToFrequency(first.label));
  }

  // Nota libre (Canción sin canción): pick persistido + flag de confirmación.
  let freeConfirmed = false;
  const freePick = (() => {
    let stored = null;
    try {
      stored = sanitizeFreeNote(localStorage.getItem(FREE_NOTE_KEY));
    } catch (_e) {
      /* ignore */
    }
    const note = stored || 'A3';
    return { pc: note.slice(0, -1), octave: Number.parseInt(note.slice(-1), 10) };
  })();

  container.innerHTML = `
    <div class="tuner-page fade-in">
      <header class="tuner-header">
        <div class="tuner-nav" id="tuner-nav"></div>
        <h1 id="tuner-title">Afinador</h1>
        <p class="tuner-header__sub" id="tuner-sub">El audio se procesa en tu dispositivo. No lo guardamos.</p>
      </header>

      <div class="tuner-body" id="tuner-body"></div>
    </div>
  `;

  const navEl = container.querySelector('#tuner-nav');
  const bodyEl = container.querySelector('#tuner-body');

  // "Volver a la canción" es estático (no depende del modo enfocado ni del
  // hub): se conserva visible mientras exista un origen `target.fromSongId`.
  // "Volver" al hub solo aparece dentro de un modo enfocado (paintNav).
  const backButton = (id, label) =>
    `<button type="button" class="btn btn--back" id="${id}">${icon('arrow-left', { size: 16 })} ${label}</button>`;

  function paintNav() {
    const backHub = mode !== null ? backButton('tuner-hub-back', 'Volver') : '';
    const backSong = target.fromSongId ? backButton('tuner-back', 'Volver a la canción') : '';
    navEl.innerHTML = backHub + backSong;
    navEl.querySelector('#tuner-hub-back')?.addEventListener('click', goToHub);
    navEl
      .querySelector('#tuner-back')
      ?.addEventListener('click', () => navigate('/song/' + target.fromSongId));
    paintHeader();
  }

  // Cabecera dinámica: en el hub muestra "Afinador" + nota de privacidad;
  // dentro de un modo enfocado muestra el nombre del modo y oculta esa nota.
  function paintHeader() {
    const titleEl = container.querySelector('#tuner-title');
    const subEl = container.querySelector('#tuner-sub');
    if (!titleEl || !subEl) return;
    if (mode === null) {
      titleEl.textContent = 'Afinador';
      subEl.hidden = false;
    } else {
      titleEl.textContent = MODE_TITLES[mode] || 'Afinador';
      subEl.hidden = true;
    }
  }

  function paintBody() {
    // Marca el modo activo en el contenedor para estilos escopados (p.ej. la
    // vista Canción se muestra a mayor tamaño via #tuner-body[data-mode='song']).
    bodyEl.dataset.mode = mode === null ? 'hub' : mode;

    if (mode === null) {
      bodyEl.innerHTML = renderHub();
      bindHub();
      return;
    }

    if (mode === 'metronomo') {
      bodyEl.innerHTML = bodyMetronomo({
        bpm: metronome ? metronome.getBpm() : DEFAULT_BPM,
        signature: metroSig,
        running: metronome ? metronome.isRunning() : false,
      });
      bindMetronomo();
      return;
    }

    if (micState !== 'running' && micState !== 'requesting') {
      bodyEl.innerHTML = bodyPermissionGate(micState);
      const grantBtn = bodyEl.querySelector('#tuner-grant');
      if (grantBtn) grantBtn.addEventListener('click', requestMic);
      return;
    }

    if (mode === 'guitar' || mode === 'voice') {
      bodyEl.innerHTML = bodyGuitarOrVoice(mode, mode === 'voice' ? targetLabel : null);
    } else if (mode === 'song') {
      if (!song && !targetLabel && !freeConfirmed) {
        bodyEl.innerHTML = bodyFreeNote(freePick);
        bindFreeNotePicker();
      } else {
        bodyEl.innerHTML = bodySong(song, targetLabel);
        if (!song && freeConfirmed) {
          const change = document.createElement('button');
          change.className = 'btn btn--secondary tuner-free__change';
          change.id = 'free-change';
          change.textContent = 'Cambiar nota';
          bodyEl.appendChild(change);
          change.addEventListener('click', () => {
            freeConfirmed = false;
            targetCanonical = null;
            targetLabel = null;
            paintBody();
          });
        }
      }
    } else if (mode === 'range') {
      bodyEl.innerHTML = bodyRange(rangeStep, '');
    } else if (mode === 'calibrar') {
      bodyEl.innerHTML = bodyCalibrar({ calCents: getCalibrationCents() });
      bindCalibrar();
    } else if (mode === 'entrenar') {
      if (!exercise) {
        bodyEl.innerHTML = bodyEntrenarPicker();
        bindEntrenarPicker();
      } else if (exerciseDone) {
        finishExercise();
      } else {
        renderExerciseRunner();
      }
    }

    if (mode === 'range') {
      bodyEl.querySelector('#range-cancel').addEventListener('click', cancelRange);
      bodyEl.querySelector('#range-start').addEventListener('click', startRangeMeasurement);
    }
  }

  /* ─── pitch handlers per mode ─── */

  function handlePitchGuitar(stab) {
    if (stab === null) {
      renderReadout(bodyEl, { label: '—', hz: null, cents: null });
      setNeedle(bodyEl, 0, '');
      return;
    }
    const nearest = nearestString(stab.hz);
    if (!nearest) return;
    const status = colorFromCents(nearest.cents);
    renderReadout(bodyEl, { label: nearest.string, hz: stab.hz, cents: nearest.cents });
    setNeedle(bodyEl, nearest.cents, status);
    const strings = bodyEl.querySelector('#tuner-strings');
    if (strings) {
      for (const li of strings.children) {
        li.dataset.active = li.dataset.string === nearest.string ? 'true' : 'false';
      }
    }
  }

  function handlePitchVoice(stab) {
    if (stab === null) {
      renderReadout(bodyEl, { label: '—', hz: null, cents: null });
      setNeedle(bodyEl, 0, '');
      const objEl = bodyEl.querySelector('#tuner-objective');
      if (objEl) objEl.dataset.match = '';
      return;
    }
    renderReadout(bodyEl, { label: `${stab.note}${stab.octave}`, hz: stab.hz, cents: stab.cents });
    setNeedle(bodyEl, stab.cents, colorFromCents(stab.cents));
    if (targetCanonical) {
      const objEl = bodyEl.querySelector('#tuner-objective');
      if (objEl) objEl.dataset.match = matchesTarget(stab, targetCanonical) ? 'ok' : '';
    }
  }

  function handlePitchSong(stab) {
    if (!song?.key && !targetCanonical) return;
    if (stab === null) {
      renderReadout(bodyEl, { label: '—', hz: null, cents: null });
      setNeedle(bodyEl, 0, '');
      const objEl = bodyEl.querySelector('#tuner-objective');
      if (objEl) objEl.dataset.match = '';
      return;
    }
    const inScale = song?.key ? getScaleNotes(song.key).includes(stab.note) : null;
    // Con objetivo, afinamos contra ESA nota: la desviacion (y el verde) se
    // miden respecto al objetivo, no a la nota mas cercana. Asi cantar otra
    // nota bien afinada NO se pone verde. Sin objetivo (modo escala pura) se
    // conserva la lectura contra la nota mas cercana.
    let cents = stab.cents;
    if (targetCanonical) {
      const targetFreq = noteToFrequency(`${targetCanonical.note}${targetCanonical.octave}`);
      cents = centsBetween(stab.hz, targetFreq);
    }
    renderReadout(bodyEl, {
      label: `${stab.note}${stab.octave}`,
      hz: stab.hz,
      cents,
      sub:
        inScale === null
          ? undefined
          : inScale
            ? `${icon('check', { size: 14 })} en escala`
            : `${icon('close', { size: 14 })} fuera de escala`,
    });
    setNeedle(bodyEl, cents, colorFromCents(cents));
    const ul = bodyEl.querySelector('#tuner-scale');
    if (ul) {
      for (const li of ul.children) {
        li.dataset.active = li.dataset.pc === stab.note ? 'true' : 'false';
      }
    }
    const readout = bodyEl.querySelector('#tuner-readout');
    if (readout && inScale !== null) readout.dataset.scale = inScale ? 'in' : 'out';
    if (targetCanonical) {
      const objEl = bodyEl.querySelector('#tuner-objective');
      if (objEl) objEl.dataset.match = matchesTarget(stab, targetCanonical) ? 'ok' : '';
    }
  }

  function handlePitchRange(stab) {
    if (rangeTimerId === null) return;
    if (stab === null || stab.held) return; // solo lecturas frescas cuentan para el rango
    rangeSamples.push({ note: `${stab.note}${stab.octave}`, hz: stab.hz });
    const label = `${stab.note}${stab.octave}`;
    const readoutNote = bodyEl.querySelector('.tuner-readout__note');
    const readoutMeta = bodyEl.querySelector('.tuner-readout__meta');
    if (readoutNote) readoutNote.textContent = label;
    if (readoutMeta) readoutMeta.textContent = `${stab.hz.toFixed(1)} Hz`;
  }

  function dispatchPitch(payload) {
    if (mode === 'guitar') return handlePitchGuitar(payload);
    if (mode === 'voice') return handlePitchVoice(payload);
    if (mode === 'song') return handlePitchSong(payload);
    if (mode === 'range') return handlePitchRange(payload);
    if (mode === 'entrenar') return handlePitchEntrenar(payload);
  }

  /* ─── range measurement ─── */

  function startRangeMeasurement() {
    const startBtn = bodyEl.querySelector('#range-start');
    if (startBtn) startBtn.disabled = true;
    rangeSamples = [];
    rangeStartMs = performance.now();
    rangeTimerId = setInterval(() => {
      const elapsed = performance.now() - rangeStartMs;
      const pct = Math.min(100, (elapsed / RANGE_STEP_MS) * 100);
      const ring = bodyEl.querySelector('#tuner-progress-ring');
      const lbl = bodyEl.querySelector('#tuner-progress-label');
      if (ring) ring.style.strokeDashoffset = `${RANGE_RING_CIRCUMFERENCE * (1 - pct / 100)}`;
      if (lbl) lbl.textContent = `${(elapsed / 1000).toFixed(1)} / 10s`;
      if (elapsed >= RANGE_STEP_MS) {
        finishRangeStep();
      }
    }, 100);
  }

  function finishRangeStep() {
    clearInterval(rangeTimerId);
    rangeTimerId = null;
    // Pick the mode of notes detected during the last 75% of the window.
    const tail = rangeSamples.slice(Math.floor(rangeSamples.length * 0.25));
    if (tail.length < 5) {
      alert('No detecté una nota sostenida. Intenta de nuevo.');
      paintBody();
      return;
    }
    const counts = {};
    for (const s of tail) counts[s.note] = (counts[s.note] || 0) + 1;
    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

    if (rangeStep === 'low') {
      rangeTempLow = winner;
      rangeStep = 'high';
      paintBody();
    } else {
      rangeTempHigh = winner;
      saveRange();
    }
  }

  async function saveRange() {
    const token = getSession()?.access_token;
    if (!token) {
      alert('Necesitas estar logueado.');
      navigate('/login');
      return;
    }
    try {
      const res = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vocalRangeLow: rangeTempLow, vocalRangeHigh: rangeTempHigh }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshProfile();
      invalidateMyProfile();
      bodyEl.innerHTML = `
        <div class="tuner-empty">
          <h2>${icon('check-circle', { size: 22 })} Listo</h2>
          <p>Tu rango: <strong>${rangeTempLow}</strong> – <strong>${rangeTempHigh}</strong></p>
          <p>Lo guardé en tu perfil.</p>
          <button class="btn btn--primary" id="range-back">Ir al perfil</button>
        </div>
      `;
      bodyEl.querySelector('#range-back').addEventListener('click', () => navigate('/perfil'));
    } catch (e) {
      showToast(`Error guardando: ${e.message}`, { type: 'error' });
      paintBody();
    }
  }

  function cancelRange() {
    if (rangeTimerId !== null) {
      clearInterval(rangeTimerId);
      rangeTimerId = null;
    }
    rangeStep = 'low';
    rangeTempLow = null;
    rangeTempHigh = null;
    rangeSamples = [];
    navigate('/perfil');
  }

  /* ─── free note picker binder ─── */

  function bindFreeNotePicker() {
    bodyEl.querySelectorAll('.tuner-free__pc').forEach((btn) => {
      btn.addEventListener('click', () => {
        freePick.pc = btn.dataset.pc;
        paintBody();
      });
    });
    bodyEl.querySelector('#free-oct-down')?.addEventListener('click', () => {
      freePick.octave = Math.max(FREE_OCT_MIN, freePick.octave - 1);
      paintBody();
    });
    bodyEl.querySelector('#free-oct-up')?.addEventListener('click', () => {
      freePick.octave = Math.min(FREE_OCT_MAX, freePick.octave + 1);
      paintBody();
    });
    bodyEl.querySelector('#free-tune')?.addEventListener('click', () => {
      const label = `${freePick.pc}${freePick.octave}`;
      targetCanonical = frequencyToNote(noteToFrequency(label));
      targetLabel = `${targetCanonical.note}${targetCanonical.octave}`;
      freeConfirmed = true;
      try {
        localStorage.setItem(FREE_NOTE_KEY, label);
      } catch (_e) {
        /* ignore */
      }
      paintBody();
    });
  }

  /* ─── entrenar binder + runners ─── */

  function bindEntrenarPicker() {
    const fit = bodyEl.querySelector('#train-fit-range');
    const profile = getProfile();
    bodyEl.querySelector('[data-train="warmup"]')?.addEventListener('click', () => {
      startExercise(
        buildWarmup({
          rangeLow: profile?.vocalRangeLow,
          rangeHigh: profile?.vocalRangeHigh,
          voiceType: profile?.voiceType,
        }),
      );
    });
    bodyEl.querySelectorAll('.tuner-train__preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = EXERCISE_PRESETS.find((p) => p.id === btn.dataset.preset);
        if (!preset) return;
        const fitRange = !!fit?.checked && profile?.vocalRangeLow && profile?.vocalRangeHigh;
        const startOctave = fitRange
          ? pickStartOctave({
              tonic: preset.tonic,
              type: preset.type,
              rangeLow: profile.vocalRangeLow,
              rangeHigh: profile.vocalRangeHigh,
            })
          : preset.tonic === 'C'
            ? 4
            : 3;
        startExercise(buildScaleSequence({ tonic: preset.tonic, type: preset.type, startOctave }));
      });
    });
  }

  function renderExerciseRunner() {
    const st = exercise.push(null); // estado actual sin avanzar
    const target = st.target;
    const chips = Array.from({ length: st.total }, (_, i) => {
      const state = i < st.index ? 'done' : i === st.index ? 'current' : 'pending';
      return `<span class="tuner-train-run__chip" data-state="${state}">${i + 1}</span>`;
    }).join('');
    bodyEl.innerHTML = `
      <div class="tuner-train-run">
        <div class="tuner-train-run__progress">Nota ${Math.min(st.index + 1, st.total)} / ${st.total}</div>
        <div class="tuner-train-run__chips" aria-hidden="true">${chips}</div>
        <div class="tuner-train-run__target" id="train-target">${target ? target.label : '—'}</div>
        <button class="btn btn--sm" id="train-ref">${icon('volume-2', { size: 14 })} Tono de referencia</button>
        <div class="tuner-readout" id="tuner-readout" data-status="">
          <div class="tuner-readout__note">—</div>
          <div class="tuner-readout__meta">— Hz · —¢</div>
        </div>
        ${renderGauge()}
        <div class="tuner-train-run__actions">
          <button class="btn btn--secondary" id="train-skip">Saltar</button>
          <button class="btn btn--secondary" id="train-quit">Terminar</button>
        </div>
      </div>
    `;
    bodyEl.querySelector('#train-ref')?.addEventListener('click', () => {
      if (target) tonePlayer.play(noteToFrequency(target.label));
    });
    bodyEl.querySelector('#train-skip')?.addEventListener('click', () => {
      const r = exercise.skip();
      if (r.done) finishExercise();
      else {
        renderExerciseRunner();
        tonePlayer.play(noteToFrequency(r.target.label));
      }
    });
    bodyEl.querySelector('#train-quit')?.addEventListener('click', () => {
      exercise = null;
      paintBody();
    });
  }

  function finishExercise() {
    const s = exercise.summary();
    exerciseDone = true;
    bodyEl.innerHTML = `
      <div class="tuner-empty">
        <h2>${icon('check-circle', { size: 22 })} Entrenamiento completado</h2>
        <p>Aciertos: <strong>${s.hits}</strong> / ${s.total}</p>
        <button class="btn btn--primary" id="train-again">Repetir</button>
      </div>
    `;
    bodyEl.querySelector('#train-again')?.addEventListener('click', () => {
      exercise.reset();
      exerciseDone = false;
      paintBody();
      const first = exercise.current();
      if (first) tonePlayer.play(noteToFrequency(first.label));
    });
  }

  function handlePitchEntrenar(stab) {
    if (!exercise || exerciseDone) return;
    if (stab === null) {
      renderReadout(bodyEl, { label: '—', hz: null, cents: null });
      setNeedle(bodyEl, 0, '');
      exercise.push(null);
      return;
    }
    // Igual que en Canción: hay una nota objetivo (la del ejercicio), asi que la
    // desviacion y el verde se miden contra ESA nota, no contra la mas cercana.
    const cur = exercise.current();
    const cents = cur ? centsBetween(stab.hz, noteToFrequency(cur.label)) : stab.cents;
    renderReadout(bodyEl, { label: `${stab.note}${stab.octave}`, hz: stab.hz, cents });
    setNeedle(bodyEl, cents, colorFromCents(cents));
    const r = exercise.push(stab);
    if (r.justAdvanced) {
      if (r.done) finishExercise();
      else {
        renderExerciseRunner();
        tonePlayer.play(noteToFrequency(r.target.label));
      }
    }
  }

  /* ─── calibrar binder ─── */

  function bindCalibrar() {
    // Fix 1: usa calPlayer hoisteado al scope de renderTuner; no se crea aquí.
    const resultEl = bodyEl.querySelector('#cal-result');
    const currentEl = bodyEl.querySelector('#cal-current');

    // Fix 4: firma actualizada — descarta muestras alejadas más de ±300 cents
    // del tono esperado para evitar que ruido o reverb de notas anteriores
    // contaminen la medición.
    function sampleDetected(expectedHz) {
      return new Promise((resolve) => {
        const samples = [];
        const onPitch = (payload) => {
          if (!payload || !Number.isFinite(payload.hz) || payload.hz <= 0) return;
          const centsDiff = Math.abs(1200 * Math.log2(payload.hz / expectedHz));
          if (centsDiff > 300) return; // demasiado lejos: ruido o nota anterior
          samples.push(payload.hz);
        };
        // Engancha temporalmente al detector vivo vía el stabilizer compartido:
        capturePitch = onPitch;
        setTimeout(() => {
          capturePitch = null;
          if (samples.length === 0) return resolve(null);
          const sorted = [...samples].sort((a, b) => a - b);
          resolve(sorted[Math.floor(sorted.length / 2)]);
        }, 900);
      });
    }

    // Fix 2: captura el botón una sola vez y lo deshabilita durante el test.
    const runBtn = bodyEl.querySelector('#cal-run');
    runBtn?.addEventListener('click', async () => {
      if (micState !== 'running') {
        resultEl.textContent = 'Activa el micrófono primero.';
        return;
      }
      // Fix 2: deshabilita para evitar dobles clics concurrentes.
      runBtn.disabled = true;
      resultEl.textContent = 'Probando…';
      try {
        const { ok, offsetCents } = await runLoopbackTest({
          tonePlayer: calPlayer,
          sampleDetected,
          // Fix 3: cancela el loop si el usuario cambió de pestaña.
          isCancelled: () => mode !== 'calibrar',
        });
        if (!ok) {
          resultEl.textContent = 'No detecté los tonos. Sube el volumen e intenta de nuevo.';
          return;
        }
        const rounded = Math.round(offsetCents);
        resultEl.innerHTML = `Offset medido: <strong>${fmtCents(rounded)}</strong>
          <button class="btn btn--sm btn--primary" id="cal-apply">Aplicar ajuste</button>`;
        resultEl.querySelector('#cal-apply')?.addEventListener('click', () => {
          const c = setCalibrationCents(rounded);
          currentEl.textContent = fmtCents(c);
          resultEl.textContent = 'Ajuste aplicado.';
        });
      } finally {
        // Fix 2: re-habilita siempre, incluso si hubo error o cancelación.
        runBtn.disabled = false;
      }
    });

    const a4Input = bodyEl.querySelector('#cal-a4');
    const a4Val = bodyEl.querySelector('#cal-a4-val');
    // Fix 5: 'input' solo actualiza las etiquetas (sin escribir a localStorage);
    // 'change' persiste al soltar el slider (un solo write).
    a4Input?.addEventListener('input', () => {
      const hz = Number(a4Input.value);
      a4Val.textContent = `${hz} Hz`;
      currentEl.textContent = fmtCents(Math.round(a4ToCents(hz)));
    });
    a4Input?.addEventListener('change', () => {
      const hz = Number(a4Input.value);
      setCalibrationCents(Math.round(a4ToCents(hz)));
    });

    bodyEl.querySelector('#cal-reset')?.addEventListener('click', () => {
      setCalibrationCents(0);
      paintBody();
    });
  }

  /* ─── metrónomo binder + visual ─── */

  function bindMetronomo() {
    const numEl = bodyEl.querySelector('#metro-bpm-num');
    const countEl = bodyEl.querySelector('#metro-count');
    const playBtn = bodyEl.querySelector('#metro-play');
    const pendulumEl = bodyEl.querySelector('#metro-pendulum');

    // El motor puede no existir todavía (primer pintado): créalo y refresca.
    // Guarda: la promesa de idb puede resolver tras cambiar de pestaña; solo
    // repintar si seguimos en el modo metrónomo.
    if (!metronome) {
      ensureMetronome().then(() => {
        if (mode === 'metronomo') paintBody();
      });
      return;
    }

    const stepBpm = (delta) => {
      const next = metronome.setBpm(metronome.getBpm() + delta);
      if (numEl) numEl.textContent = String(next);
      if (pendulumEl) pendulumEl.style.setProperty('--metro-pendulum-duration', `${Math.round(120000 / next)}ms`);
      persistMetronome();
    };

    // Hold-to-repeat en las flechas: primer paso inmediato, luego repetición.
    const holdStart = (delta) => {
      stepBpm(delta);
      clearTimeout(metroHoldTimer);
      let speed = 300;
      const tick = () => {
        stepBpm(delta);
        speed = Math.max(40, speed - 30);
        metroHoldTimer = setTimeout(tick, speed);
      };
      metroHoldTimer = setTimeout(tick, 400);
    };
    const holdStop = () => clearTimeout(metroHoldTimer);

    const upBtn = bodyEl.querySelector('#metro-up');
    const downBtn = bodyEl.querySelector('#metro-down');
    for (const [btn, d] of [
      [upBtn, 1],
      [downBtn, -1],
    ]) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        holdStart(d);
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
        btn.addEventListener(ev, holdStop);
      }
    }

    // Selector de compás.
    for (const sb of bodyEl.querySelectorAll('.metro-sig__btn')) {
      sb.addEventListener('click', () => {
        metroSig = sb.dataset.sig;
        metronome.setSignature(metroSig);
        persistMetronome();
        paintBody(); // re-renderiza los puntos del nuevo compás
        // paintBody reemplazó el DOM: si sonaba, reengancha el visual a los
        // puntos nuevos (startMetroVisual cancela el loop previo).
        if (metronome.isRunning()) startMetroVisual();
      });
    }

    // Play / Stop.
    playBtn.addEventListener('click', () => {
      if (metronome.isRunning()) {
        metronome.stop();
        stopMetroVisual();
        playBtn.textContent = 'Iniciar';
        if (countEl) countEl.textContent = '—';
        if (pendulumEl) pendulumEl.dataset.running = 'false';
      } else {
        metronome.start();
        playBtn.textContent = 'Detener';
        startMetroVisual();
        if (pendulumEl) pendulumEl.dataset.running = 'true';
      }
    });

    // Tap tempo (aplica al instante).
    bodyEl.querySelector('#metro-tap').addEventListener('click', () => {
      const est = metronome.tap();
      if (est !== null) {
        if (numEl) numEl.textContent = String(est);
        persistMetronome();
      }
    });
  }

  // Sincroniza puntos + conteo al reloj de audio (patrón draw() de cwilso).
  function startMetroVisual() {
    // Idempotente: cancela un loop rAF previo para no dejar dos vivos, pero NO
    // vacía metroQueue — start() ya encoló el primer beat antes de llamarnos.
    if (metroRaf !== null) {
      cancelAnimationFrame(metroRaf);
      metroRaf = null;
    }
    const dots = bodyEl.querySelectorAll('.metro-dot');
    const countEl = bodyEl.querySelector('#metro-count');
    let shownBeat = -1;
    const draw = () => {
      if (!metronome || !metronome.isRunning()) return;
      const t = metronome.audioTime();
      while (metroQueue.length && metroQueue[0].time <= t) {
        shownBeat = metroQueue.shift().beat;
      }
      if (shownBeat >= 0) {
        dots.forEach((d, i) => d.classList.toggle('metro-dot--on', i === shownBeat));
        if (countEl) countEl.textContent = String(shownBeat + 1);
      }
      metroRaf = requestAnimationFrame(draw);
    };
    metroRaf = requestAnimationFrame(draw);
  }

  /* ─── mic lifecycle ─── */

  function requestMic() {
    if (detector) return;
    detector = createPitchDetector({
      onPitch: (payload) => {
        const calCents = getCalibrationCents();
        const corrected =
          payload && Number.isFinite(payload.hz) && payload.hz > 0
            ? { ...payload, hz: applyCalibration(payload.hz, calCents) }
            : payload;
        // El auto-test mide el offset ABSOLUTO del dispositivo y se aplica como
        // reemplazo (setCalibrationCents): debe ver el hz crudo, sin calibrar.
        if (capturePitch && payload) capturePitch(payload);
        dispatchPitch(stabilizer.push(corrected));
      },
      onError: (err) => {
        console.warn('[tuner] mic error:', err);
        micState = 'denied';
        paintBody();
      },
      onState: (s) => {
        micState = s;
        if (s === 'running' || s === 'denied' || s === 'stopped') paintBody();
      },
    });
    detector.start();
  }

  /* ─── navegación hub ↔ modo enfocado ─── */

  // Detiene/resetea todo lo que quedó en curso del modo que se abandona
  // (mismo cleanup que antes vivía inline en el click de tabs).
  function cleanupModeState() {
    stabilizer.reset();
    // Cancel any in-progress range timer when switching away.
    if (rangeTimerId !== null) {
      clearInterval(rangeTimerId);
      rangeTimerId = null;
    }
    // Fix 3: si había un test de calibración en curso, cancela la captura y
    // corta el tono que pudiera estar sonando.
    capturePitch = null;
    calPlayer.stop();
    // Resetea el estado de entrenar al cambiar de modo.
    exercise = null;
    exerciseDone = false;
    tonePlayer.stop();
    if (metronome) metronome.stop();
    stopMetroVisual();
  }

  function switchMode(nextMode) {
    if (nextMode === mode) return;
    cleanupModeState();
    mode = nextMode;
    paintNav();
    paintBody();
    if (MIC_MODES.has(mode)) attemptAutoStartMic();
  }

  function goToHub() {
    if (mode === null) return;
    cleanupModeState();
    mode = null;
    paintNav();
    paintBody();
  }

  function bindHub() {
    bodyEl.querySelectorAll('.tuner-hub__tile').forEach((btn) => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });
  }

  /* ─── cleanup on route change ─── */

  // onRouteChange (no solo 'hashchange'): navigate(path, {replace:true}) usa
  // history.replaceState y no dispara 'hashchange' (logout, expiracion de
  // sesion via guardedRoute) — con solo 'hashchange' el mic, el AudioContext
  // y el worklet quedaban vivos, mas un setInterval huerfano.
  const cleanupOnRouteChange = () => {
    if (!window.location.hash.startsWith('#/afinador')) {
      if (detector) {
        detector.stop();
        detector = null;
      }
      if (rangeTimerId !== null) clearInterval(rangeTimerId);
      // Fix 1: cierra el AudioContext del player de calibración para liberar
      // recursos de audio al abandonar la ruta.
      calPlayer.close();
      tonePlayer.close();
      if (metronome) {
        metronome.dispose();
        metronome = null;
      }
      stopMetroVisual();
      clearTimeout(metroHoldTimer);
      unsubscribeTunerRoute();
    }
  };
  const unsubscribeTunerRoute = onRouteChange(cleanupOnRouteChange);

  paintNav();
  paintBody();

  // Micrófono persistente: si el permiso ya está concedido, arrancar sin pedir
  // un tap. Salvedad iOS: si el AudioContext no resuelve sin gesto, el gate
  // sigue disponible como fallback. Sin Permissions API → gate normal.
  // Solo se intenta al montar si ya entramos directo a un modo enfocado que
  // necesita mic (deep-link o shortcut desde canción); el hub nunca lo pide.
  if (mode !== null && MIC_MODES.has(mode)) {
    await attemptAutoStartMic();
  }

  async function attemptAutoStartMic() {
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'microphone' });
        if (shouldAutoStartMic(status.state)) requestMic();
      }
    } catch (_e) {
      /* Permissions API no soporta 'microphone' (Safari antiguo): gate normal */
    }
  }
}
