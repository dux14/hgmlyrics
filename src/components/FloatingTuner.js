/**
 * FloatingTuner.js — Afinador bajo demanda en barra flotante (T5).
 *
 * Envuelve `createTunerStrip` (src/lib/tunerWidget.js) en un contenedor fijo
 * anclado al fondo, con header (nota objetivo grande + label de voz) y botón
 * de cierre. Se abre desde el mic del hero (#hero-tuner-mic, SongView.js);
 * el click del mic ES el gesto de usuario que arranca el detector — mismo
 * requisito de iOS Safari que ya cumple `createTunerStrip`/`pitch.js`.
 * Se destruye en cambio de ruta (mismo patrón que `destroySectionPlayer` en
 * SongView.js) o al tocar la X.
 */

import { createTunerStrip } from '../lib/tunerWidget.js';
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

/**
 * Abre la barra flotante del afinador dentro de `container`.
 * @param {HTMLElement} container
 * @param {{ note?: string|null, voiceLabel?: string, onClose?: () => void }} opts
 *   `note`: nota objetivo ya transpuesta, formato científico ("F#3"); `null`
 *   deja el afinador en modo libre (sin objetivo).
 * @returns {{ el: HTMLElement, setNote: (note: string|null) => void, destroy: () => void }}
 */
export function openFloatingTuner(container, { note = null, voiceLabel = '', onClose } = {}) {
  let currentNote = note;

  const strip = createTunerStrip({ getTargetNote: () => noteToMidiSafe(currentNote) });

  const el = document.createElement('div');
  el.className = 'floating-tuner';
  el.innerHTML = `
    <div class="floating-tuner__header">
      <div class="floating-tuner__note" id="floating-tuner-note">${escapeHtml(displayNote(currentNote ?? '', getChordNotation()) || '—')}</div>
      <div class="floating-tuner__label">${escapeHtml(voiceLabel)} · nota objetivo</div>
      <button type="button" class="floating-tuner__close" aria-label="Cerrar afinador">${icon('close', { size: 16 })}</button>
    </div>
  `;
  el.appendChild(strip.el);
  container.appendChild(el);

  const closeBtn = el.querySelector('.floating-tuner__close');

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
    strip.stop();
    el.remove();
  }

  closeBtn.addEventListener('click', () => {
    destroy();
    onClose?.();
  });

  strip.start();
  closeBtn.focus();

  function setNote(nextNote) {
    currentNote = nextNote ?? null;
    const noteEl = el.querySelector('#floating-tuner-note');
    if (noteEl) noteEl.textContent = displayNote(currentNote ?? '', getChordNotation()) || '—';
    strip.setTargetNote(noteToMidiSafe(currentNote));
  }

  return { el, setNote, destroy };
}
