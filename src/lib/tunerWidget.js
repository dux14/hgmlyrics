/**
 * tunerWidget.js — Franja delgada del afinador embebida en el modo escenario (F3).
 *
 * Reusa el mismo detector/estabilizador que Tuner.js pero afina contra una nota
 * OBJETIVO externa (la nota de la línea actual del teleprompter) en vez de la
 * nota más cercana: `cents = 100 * (midiDetectado - midiObjetivo) + centsFinos`,
 * así cantar una nota distinta bien afinada NO se pone verde (igual criterio que
 * `handlePitchSong`/`handlePitchEntrenar` en Tuner.js). Sin nota objetivo, cae en
 * modo libre (nota detectada centrada, sin objetivo).
 */

import { createPitchDetector } from './pitch.js';
import { createPitchStabilizer } from './pitchStabilizer.js';
import { centsToBarPercent } from './tunerGauge.js';
import { midiToName } from './notes.js';
import { displayNote, getChordNotation } from './chordNotation.js';
import { icon } from './icons.js';

/** Umbral de color: <10¢ ok, <30¢ warn, resto bad (mismo criterio que Tuner.js). */
export function colorFromCents(cents) {
  const abs = Math.abs(cents);
  if (abs < 10) return 'ok';
  if (abs < 30) return 'warn';
  return 'bad';
}

/**
 * @param {{ getTargetNote?: () => number|null }} [opts]
 *   `getTargetNote`: midi inicial a usar al llamar `start()` (opcional; el
 *   caller normalmente lo actualiza después vía `setTargetNote`).
 * @returns {{ el: HTMLElement, start: () => void, stop: () => void,
 *             setTargetNote: (midi: number|null) => void, isRunning: () => boolean }}
 */
export function createTunerStrip({ getTargetNote } = {}) {
  let targetMidi = typeof getTargetNote === 'function' ? getTargetNote() : null;
  let detector = null;
  const stabilizer = createPitchStabilizer();
  let micState = 'idle'; // 'idle' | 'requesting' | 'running' | 'denied' | 'stopped'
  let running = false;

  const el = document.createElement('div');
  el.className = 'tuner-strip';

  function requestMic() {
    if (!detector) {
      detector = createPitchDetector({
        onPitch: (payload) => handlePitch(stabilizer.push(payload)),
        onError: (err) => {
          console.warn('[tuner-strip] mic error:', err);
        },
        onState: (s) => {
          micState = s;
          render();
        },
      });
    }
    detector.start();
  }

  function handlePitch(stab) {
    const indicator = el.querySelector('#tuner-strip-indicator');
    if (!indicator) return; // gate visible: aún sin permiso
    if (stab === null) {
      indicator.style.left = '50%';
      indicator.dataset.status = '';
      return;
    }
    const cents = targetMidi !== null ? 100 * (stab.midi - targetMidi) + stab.cents : stab.cents;
    indicator.style.left = `${centsToBarPercent(cents)}%`;
    indicator.dataset.status = colorFromCents(cents);
    if (targetMidi === null) {
      const label = el.querySelector('#tuner-strip-label');
      if (label) label.textContent = displayNote(`${stab.note}${stab.octave}`, getChordNotation());
    }
  }

  function render() {
    if (!running) {
      el.innerHTML = '';
      return;
    }
    if (micState !== 'running' && micState !== 'requesting') {
      el.innerHTML = `
        <div class="tuner-strip__gate">
          <button type="button" class="tuner-strip__grant" id="tuner-strip-grant">
            ${icon('mic', { size: 14 })} Activar micrófono
          </button>
        </div>
      `;
      el.querySelector('#tuner-strip-grant')?.addEventListener('click', requestMic);
      return;
    }
    const label =
      targetMidi !== null ? displayNote(midiToName(targetMidi), getChordNotation()) : null;
    el.innerHTML = `
      <div class="tuner-strip__label" id="tuner-strip-label">${label ?? '—'}</div>
      <div class="tuner-strip__track" aria-hidden="true">
        <div class="tuner-strip__center"></div>
        <div class="tuner-strip__indicator" id="tuner-strip-indicator" data-status="" style="left: 50%"></div>
      </div>
      ${label ? '' : '<p class="tuner-strip__hint">Elige tu voz para afinar contra la nota</p>'}
    `;
  }

  function start() {
    if (running) return;
    running = true;
    if (typeof getTargetNote === 'function') targetMidi = getTargetNote();
    render();
    requestMic();
  }

  /** Libera SIEMPRE el detector (mic nunca queda abierto). Idempotente. */
  function stop() {
    running = false;
    if (detector) {
      detector.stop();
      detector = null;
    }
    stabilizer.reset();
    micState = 'idle';
    render();
  }

  function setTargetNote(midi) {
    targetMidi = midi ?? null;
    render();
  }

  render();

  return { el, start, stop, setTargetNote, isRunning: () => running };
}
