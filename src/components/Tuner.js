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
import { createPitchDetector } from '../lib/pitch.js';
import {
  frequencyToNote,
  noteToFrequency,
  nearestString,
  getScaleNotes,
  GUITAR_STANDARD,
  parseTunerTarget,
} from '../lib/notes.js';
import { fetchSongDetail } from '../lib/store.js';
import { getSession, refreshProfile } from '../lib/authStore.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';

const MODES = [
  { id: 'guitar', label: `${icon('audio-lines', { size: 15 })} Guitarra` },
  { id: 'voice', label: `${icon('mic', { size: 15 })} Voz` },
  { id: 'song', label: `${icon('music', { size: 15 })} Canción` },
  { id: 'range', label: `${icon('ruler', { size: 15 })} Rango` },
];

const RANGE_STEP_MS = 10000;

function parseQuery(query) {
  const out = {};
  if (!query) return out;
  for (const part of query.split('&')) {
    const [k, v] = part.split('=');
    out[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return out;
}

function colorFromCents(cents) {
  const abs = Math.abs(cents);
  if (abs < 10) return 'ok';
  if (abs < 30) return 'warn';
  return 'bad';
}

function clampCents(c) {
  if (c === null || c === undefined) return 0;
  return Math.max(-50, Math.min(50, c));
}

function renderGauge() {
  return `
    <div class="tuner-gauge" aria-hidden="true">
      <div class="tuner-gauge__track">
        <span class="tuner-gauge__mark" style="left:0%"></span>
        <span class="tuner-gauge__mark" style="left:40%"></span>
        <span class="tuner-gauge__mark tuner-gauge__mark--zero" style="left:50%"></span>
        <span class="tuner-gauge__mark" style="left:60%"></span>
        <span class="tuner-gauge__mark" style="left:100%"></span>
        <span class="tuner-gauge__needle" id="tuner-needle"></span>
      </div>
      <div class="tuner-gauge__scale">
        <span>−50</span><span>−10</span><span>0</span><span>+10</span><span>+50</span>
      </div>
    </div>
  `;
}

function setNeedle(container, cents, statusClass) {
  const needle = container.querySelector('#tuner-needle');
  if (!needle) return;
  const pct = 50 + clampCents(cents);
  needle.style.left = `${pct}%`;
  needle.dataset.status = statusClass || '';
}

function renderReadout(container, { label, hz, cents, sub }) {
  const el = container.querySelector('#tuner-readout');
  if (!el) return;
  const hzText = hz === null || hz === undefined ? '— Hz' : `${hz.toFixed(1)} Hz`;
  const centsText =
    cents === null || cents === undefined ? '—¢' : `${cents > 0 ? '+' : ''}${cents}¢`;
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
      ? `<p class="tuner-objective" id="tuner-objective">Objetivo: <strong>${targetNote}</strong></p>`
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
        ? 'Tocá una cuerda. Se resalta la nota objetivo más cercana.'
        : targetNote
          ? `Cantá ${targetNote} sostenida. Se pone en verde cuando coincide.`
          : 'Cantá una nota sostenida.'
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
  if (!song?.key) {
    return `
      <div class="tuner-empty">
        <p>Esta canción no tiene tonalidad asignada todavía.</p>
        <p>Pedile al admin que la configure en el editor.</p>
      </div>
    `;
  }
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
          .map((n) => `<li data-pc="${n}"${n === targetPc ? ' data-target="true"' : ''}>${n}</li>`)
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
        ? `Cantá <strong>${targetLabel}</strong>. Se pone verde al coincidir. Verde claro = nota en escala de ${song.key}.`
        : `Verde = la nota pertenece a <em>${song.key}</em>. Rojo = fuera de escala.`
    }</p>
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
        Cantala sostenida durante <strong>10 segundos</strong>.
      </p>

      <div class="tuner-readout" id="tuner-readout" data-status="">
        <div class="tuner-readout__note">${currentNote || '—'}</div>
        <div class="tuner-readout__meta">— Hz · —¢</div>
      </div>

      <div class="tuner-progress">
        <div class="tuner-progress__bar" id="tuner-progress-bar"></div>
      </div>
      <div class="tuner-progress__label" id="tuner-progress-label">0 / 10s</div>

      <div class="tuner-range__actions">
        <button class="btn btn--secondary" id="range-cancel">Cancelar</button>
        <button class="btn btn--primary" id="range-start">Empezar</button>
      </div>
    </div>
  `;
}

/* ─── Mic permission gate ─── */

function bodyPermissionGate(state) {
  if (state === 'denied') {
    return `
      <div class="tuner-perm">
        <p>${icon('mic', { size: 16 })} Microfono bloqueado.</p>
        <p>Habilitalo en los permisos del sitio para usar el afinador.</p>
      </div>
    `;
  }
  return `
    <div class="tuner-perm">
      <p>${icon('mic', { size: 16 })} Necesito acceso al micrófono para detectar el tono.</p>
      <button class="btn btn--primary" id="tuner-grant">Permitir micrófono</button>
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
  const defaultMode = target.note ? 'voice' : 'guitar';
  let mode = params.mode && MODES.some((m) => m.id === params.mode) ? params.mode : defaultMode;
  const songId = params.songId || null;

  // Canonical (sharp-spelled) target so it matches frequencyToNote output,
  // e.g. an incoming "Bb5" becomes { note: 'A#', octave: 5 }.
  const targetCanonical = target.note ? frequencyToNote(noteToFrequency(target.note)) : null;
  const targetLabel = targetCanonical ? `${targetCanonical.note}${targetCanonical.octave}` : null;
  let song = null;
  if (mode === 'song' && songId) {
    song = await fetchSongDetail(songId).catch(() => null);
  }

  /** @type {ReturnType<typeof createPitchDetector> | null} */
  let detector = null;
  let micState = 'idle'; // 'idle' | 'requesting' | 'running' | 'denied' | 'stopped'
  // Range-mode state
  let rangeStep = 'low';
  let rangeTempLow = null;
  let rangeTempHigh = null;
  let rangeTimerId = null;
  let rangeStartMs = 0;
  let rangeSamples = [];

  container.innerHTML = `
    <div class="tuner-page fade-in">
      <header class="tuner-header">
        ${
          target.fromSongId
            ? `<button class="btn btn--sm tuner-back" id="tuner-back">${icon('arrow-left', { size: 14 })} Volver a la canción</button>`
            : ''
        }
        <h1>Afinador <span class="badge--beta">BETA</span></h1>
        <p class="tuner-header__sub">El audio se procesa en tu dispositivo. No lo guardamos.</p>
      </header>

      <nav class="tuner-tabs" role="tablist" id="tuner-tabs">
        ${MODES.map(
          (m) =>
            `<button class="tuner-tabs__btn" role="tab" data-mode="${m.id}" aria-selected="${m.id === mode}">${m.label}</button>`,
        ).join('')}
      </nav>

      <div class="tuner-body" id="tuner-body"></div>
    </div>
  `;

  const tabsEl = container.querySelector('#tuner-tabs');
  const bodyEl = container.querySelector('#tuner-body');

  const backBtn = container.querySelector('#tuner-back');
  if (backBtn && target.fromSongId) {
    backBtn.addEventListener('click', () => navigate('/song/' + target.fromSongId));
  }

  function paintTabs() {
    for (const btn of tabsEl.querySelectorAll('button')) {
      btn.setAttribute('aria-selected', btn.dataset.mode === mode ? 'true' : 'false');
    }
  }

  function paintBody() {
    if (micState !== 'running' && micState !== 'requesting') {
      bodyEl.innerHTML = bodyPermissionGate(micState);
      const grantBtn = bodyEl.querySelector('#tuner-grant');
      if (grantBtn) grantBtn.addEventListener('click', requestMic);
      return;
    }

    if (mode === 'guitar' || mode === 'voice') {
      bodyEl.innerHTML = bodyGuitarOrVoice(mode, mode === 'voice' ? targetLabel : null);
    } else if (mode === 'song') bodyEl.innerHTML = bodySong(song, targetLabel);
    else if (mode === 'range') bodyEl.innerHTML = bodyRange(rangeStep, '');

    if (mode === 'range') {
      bodyEl.querySelector('#range-cancel').addEventListener('click', cancelRange);
      bodyEl.querySelector('#range-start').addEventListener('click', startRangeMeasurement);
    }
  }

  /* ─── pitch handlers per mode ─── */

  function handlePitchGuitar({ hz }) {
    if (hz === null) {
      renderReadout(bodyEl, { label: '—', hz: null, cents: null });
      setNeedle(bodyEl, 0, '');
      return;
    }
    const nearest = nearestString(hz);
    if (!nearest) return;
    const status = colorFromCents(nearest.cents);
    renderReadout(bodyEl, { label: nearest.string, hz, cents: nearest.cents });
    setNeedle(bodyEl, nearest.cents, status);
    // highlight closest string
    const strings = bodyEl.querySelector('#tuner-strings');
    if (strings) {
      for (const li of strings.children) {
        li.dataset.active = li.dataset.string === nearest.string ? 'true' : 'false';
      }
    }
  }

  function handlePitchVoice({ hz }) {
    if (hz === null) {
      renderReadout(bodyEl, { label: '—', hz: null, cents: null });
      setNeedle(bodyEl, 0, '');
      const objEl = bodyEl.querySelector('#tuner-objective');
      if (objEl) objEl.dataset.match = '';
      return;
    }
    const r = frequencyToNote(hz);
    if (!r) return;
    renderReadout(bodyEl, { label: `${r.note}${r.octave}`, hz, cents: r.cents });
    setNeedle(bodyEl, r.cents, colorFromCents(r.cents));
    // When aiming for a target note, flag the objective as "ok" once the
    // detected note matches name+octave and is within 10 cents.
    if (targetCanonical) {
      const matched =
        r.note === targetCanonical.note &&
        r.octave === targetCanonical.octave &&
        Math.abs(r.cents) < 10;
      const objEl = bodyEl.querySelector('#tuner-objective');
      if (objEl) objEl.dataset.match = matched ? 'ok' : '';
    }
  }

  function handlePitchSong({ hz }) {
    if (!song?.key) return;
    if (hz === null) {
      renderReadout(bodyEl, { label: '—', hz: null, cents: null });
      setNeedle(bodyEl, 0, '');
      return;
    }
    const r = frequencyToNote(hz);
    if (!r) return;
    const scale = getScaleNotes(song.key);
    const inScale = scale.includes(r.note);
    renderReadout(bodyEl, {
      label: `${r.note}${r.octave}`,
      hz,
      cents: r.cents,
      sub: inScale
        ? `${icon('check', { size: 14 })} en escala`
        : `${icon('close', { size: 14 })} fuera de escala`,
    });
    setNeedle(bodyEl, r.cents, colorFromCents(r.cents));
    const ul = bodyEl.querySelector('#tuner-scale');
    if (ul) {
      for (const li of ul.children) {
        li.dataset.active = li.dataset.pc === r.note ? 'true' : 'false';
      }
    }
    const readout = bodyEl.querySelector('#tuner-readout');
    if (readout) readout.dataset.scale = inScale ? 'in' : 'out';
  }

  function handlePitchRange({ hz }) {
    if (rangeTimerId === null) return; // not measuring
    if (hz === null) return;
    const r = frequencyToNote(hz);
    if (!r) return;
    rangeSamples.push({ note: `${r.note}${r.octave}`, hz });
    const label = `${r.note}${r.octave}`;
    const readoutNote = bodyEl.querySelector('.tuner-readout__note');
    const readoutMeta = bodyEl.querySelector('.tuner-readout__meta');
    if (readoutNote) readoutNote.textContent = label;
    if (readoutMeta) readoutMeta.textContent = `${hz.toFixed(1)} Hz`;
  }

  function dispatchPitch(payload) {
    if (mode === 'guitar') return handlePitchGuitar(payload);
    if (mode === 'voice') return handlePitchVoice(payload);
    if (mode === 'song') return handlePitchSong(payload);
    if (mode === 'range') return handlePitchRange(payload);
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
      const bar = bodyEl.querySelector('#tuner-progress-bar');
      const lbl = bodyEl.querySelector('#tuner-progress-label');
      if (bar) bar.style.width = `${pct}%`;
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
      alert('No detecté una nota sostenida. Intentá de nuevo.');
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
      alert('Necesitás estar logueado.');
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
      alert(`Error guardando: ${e.message}`);
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

  /* ─── mic lifecycle ─── */

  function requestMic() {
    if (detector) return;
    detector = createPitchDetector({
      onPitch: dispatchPitch,
      onError: (err) => {
        console.warn('[tuner] mic error:', err);
        micState = 'denied';
        paintBody();
      },
      onState: (s) => {
        micState = s;
        // Re-paint when transitioning into running (first frame).
        if (s === 'running' || s === 'denied' || s === 'stopped') paintBody();
      },
    });
    detector.start();
  }

  /* ─── tab clicks ─── */

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    const nextMode = btn.dataset.mode;
    if (nextMode === mode) return;
    mode = nextMode;
    // Cancel any in-progress range timer when switching away.
    if (rangeTimerId !== null) {
      clearInterval(rangeTimerId);
      rangeTimerId = null;
    }
    paintTabs();
    paintBody();
  });

  /* ─── cleanup on route change ─── */

  const cleanupOnHashChange = () => {
    if (!window.location.hash.startsWith('#/afinador')) {
      if (detector) {
        detector.stop();
        detector = null;
      }
      if (rangeTimerId !== null) clearInterval(rangeTimerId);
      window.removeEventListener('hashchange', cleanupOnHashChange);
    }
  };
  window.addEventListener('hashchange', cleanupOnHashChange);

  paintTabs();
  paintBody();
}
