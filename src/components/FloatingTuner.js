/**
 * FloatingTuner.js — Afinador flotante híbrido bajo demanda (T5 + T2 refino).
 *
 * Abre SIEMPRE en modo libre: detecta y muestra la nota más cercana, aunque
 * SongView tenga una voz activa con nota objetivo. El chip "Seguir nota"
 * (visible solo si hay nota de voz disponible) es el toggle explícito que
 * activa el modo objetivo — la fórmula de cents contra la nota objetivo es
 * la misma que usa `createTunerStrip` en `tunerWidget.js`. El chip nace
 * siempre apagado (no se persiste entre aperturas).
 *
 * Consume `createTunerEngine` directamente (mic pipeline + estabilizador,
 * sin DOM) y dibuja su propio layout: nota detectada + cents a la izquierda,
 * gauge lineal de 5 zonas a la derecha, estado/chip debajo. Se abre desde el
 * mic del hero (#hero-tuner-mic, SongView.js); el click del mic ES el gesto
 * de usuario que arranca el detector — mismo requisito de iOS Safari que ya
 * cumple `pitch.js`. Se destruye en cambio de ruta (mismo patrón que
 * `destroySectionPlayer` en SongView.js) o al tocar la X.
 *
 * `createTunerStrip` (misma tunerWidget.js) queda intacta para StageMode.
 */

import { createTunerEngine, colorFromCents } from '../lib/tunerWidget.js';
import { centsToBarPercent } from '../lib/tunerGauge.js';
import { noteToMidi } from '../lib/notes.js';
import { displayNote, getChordNotation } from '../lib/chordNotation.js';
import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';

/** Nota científica ("F#3") → midi, o null si falta/invalida. */
function noteToMidiSafe(note) {
  if (!note) return null;
  try {
    return noteToMidi(note);
  } catch {
    return null;
  }
}

const GAUGE_HTML = `
  <div class="tuner-gauge floating-tuner__gauge" aria-hidden="true">
    <div class="tuner-gauge__track">
      <div class="tuner-gauge__zone tuner-gauge__zone--danger tuner-gauge__zone--danger-left"></div>
      <div class="tuner-gauge__zone tuner-gauge__zone--warn tuner-gauge__zone--warn-left"></div>
      <div class="tuner-gauge__zone tuner-gauge__zone--ok"></div>
      <div class="tuner-gauge__zone tuner-gauge__zone--warn tuner-gauge__zone--warn-right"></div>
      <div class="tuner-gauge__zone tuner-gauge__zone--danger tuner-gauge__zone--danger-right"></div>
      <div class="tuner-gauge__center-mark"></div>
      <div id="floating-tuner-indicator" class="tuner-gauge__indicator" data-status="" style="left: 50%"></div>
    </div>
  </div>
`;

const GATE_HTML = `
  <div class="floating-tuner__gate">
    <button type="button" class="floating-tuner__grant" id="floating-tuner-grant">
      ${icon('mic', { size: 14 })} Activar micrófono
    </button>
  </div>
`;

/**
 * Abre la barra flotante del afinador dentro de `container`.
 * @param {HTMLElement} container
 * @param {{ note?: string|null, voiceLabel?: string, onClose?: () => void }} opts
 *   `note`: nota de la voz activa en SongView, formato científico ("F#3");
 *   `null` sin voz activa (oculta el chip "Seguir nota"). Nunca es el
 *   objetivo por defecto — solo lo es con el chip encendido.
 * @returns {{ el: HTMLElement, setNote: (note: string|null) => void, destroy: () => void }}
 */
export function openFloatingTuner(container, { note = null, voiceLabel = '', onClose } = {}) {
  let availableNote = note;
  let followMode = false; // chip "Seguir nota": nace apagado en cada apertura
  let micState = 'idle';
  let lastStab = null;

  const el = document.createElement('div');
  el.className = 'floating-tuner';
  el.innerHTML = `
    <button type="button" class="floating-tuner__close" aria-label="Cerrar afinador">${icon('close', { size: 16 })}</button>
    <div class="floating-tuner__row">
      <div class="floating-tuner__pitch">
        <div class="floating-tuner__note" id="floating-tuner-note">—</div>
        <div class="floating-tuner__cents" id="floating-tuner-cents"></div>
      </div>
      <div class="floating-tuner__engine" id="floating-tuner-engine"></div>
    </div>
    <div class="floating-tuner__footer" id="floating-tuner-footer"></div>
  `;
  container.appendChild(el);

  const closeBtn = el.querySelector('.floating-tuner__close');
  const noteEl = el.querySelector('#floating-tuner-note');
  const centsEl = el.querySelector('#floating-tuner-cents');
  const engineArea = el.querySelector('#floating-tuner-engine');
  const footerArea = el.querySelector('#floating-tuner-footer');

  function targetMidi() {
    return followMode ? noteToMidiSafe(availableNote) : null;
  }

  function currentCents() {
    if (!lastStab) return null;
    const target = targetMidi();
    return target !== null ? 100 * (lastStab.midi - target) + lastStab.cents : lastStab.cents;
  }

  function noteLabel() {
    if (followMode) return displayNote(availableNote ?? '', getChordNotation()) || '—';
    if (lastStab) return displayNote(`${lastStab.note}${lastStab.octave}`, getChordNotation());
    return '—';
  }

  /** Actualiza nota/cents/indicador según el último stab y el modo actual. */
  function renderPitch() {
    noteEl.textContent = noteLabel();
    const indicator = el.querySelector('#floating-tuner-indicator');
    const c = currentCents();
    if (c === null) {
      centsEl.textContent = '';
      centsEl.removeAttribute('data-status');
      if (indicator) {
        indicator.style.left = '50%';
        indicator.dataset.status = '';
      }
      return;
    }
    const status = colorFromCents(c);
    centsEl.textContent = `${c > 0 ? '+' : ''}${c} ¢`;
    centsEl.dataset.status = status;
    if (indicator) {
      indicator.style.left = `${centsToBarPercent(c)}%`;
      indicator.dataset.status = status;
    }
  }

  /** Redibuja las áreas que dependen del mic: gate o gauge+footer. */
  function renderEngine() {
    if (micState !== 'running' && micState !== 'requesting') {
      engineArea.innerHTML = GATE_HTML;
      footerArea.innerHTML = '';
      engineArea
        .querySelector('#floating-tuner-grant')
        ?.addEventListener('click', engine.requestMic);
      renderPitch();
      return;
    }
    const chipVisible = !!availableNote;
    engineArea.innerHTML = GAUGE_HTML;
    footerArea.innerHTML = `
      <span class="floating-tuner__status">${escapeHtml(followMode ? voiceLabel : 'Modo libre')}</span>
      ${
        chipVisible
          ? `<button type="button" class="floating-tuner__chip" id="floating-tuner-chip" aria-pressed="${followMode}">Seguir nota</button>`
          : ''
      }
    `;
    footerArea.querySelector('#floating-tuner-chip')?.addEventListener('click', () => {
      followMode = !followMode;
      renderEngine();
    });
    renderPitch();
  }

  const engine = createTunerEngine({
    onPitch: (stab) => {
      lastStab = stab;
      renderPitch();
    },
    onState: (s) => {
      micState = s;
      // El mic puede morir tras una lectura válida (p.ej. `recover()` de
      // pitch.js falla al volver de background en iOS y reporta 'stopped').
      // Sin esto la columna de pitch (independiente de micState) se queda
      // mostrando la última lectura "afinada" junto al gate de "Activar
      // micrófono", como si el afinador siguiera escuchando.
      if (s !== 'running' && s !== 'requesting') lastStab = null;
      renderEngine();
    },
    onError: (err) => console.warn('[floating-tuner] mic error:', err),
  });

  // Escape cierra igual que la X (mismo patrón que OptionsSheet.js): el
  // listener vive en document porque la barra no atrapa foco (no es un
  // modal), y se retira SIEMPRE en destroy() sin importar la salida (X,
  // Escape, re-click del mic que la cierra, o route change en SongView.js).
  function onKeydown(e) {
    if (e.key === 'Escape') {
      destroy();
      onClose?.();
    }
  }
  document.addEventListener('keydown', onKeydown);

  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('keydown', onKeydown);
    engine.stop();
    el.remove();
  }

  closeBtn.addEventListener('click', () => {
    destroy();
    onClose?.();
  });

  renderEngine();
  engine.start();
  closeBtn.focus();

  function setNote(nextNote) {
    availableNote = nextNote ?? null;
    // Sin voz activa no hay objetivo posible: vuelve a modo libre y el chip
    // se oculta (spec: "el widget vuelve a libre y el chip se oculta").
    if (availableNote === null) followMode = false;
    renderEngine();
  }

  return { el, setNote, destroy };
}
