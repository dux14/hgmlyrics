/**
 * OptionsSheet.js — Bottom-sheet "Opciones" unificado (T4, evoluciona VoiceSheet.js).
 *
 * Disponible en TODAS las resoluciones (en desktop: ancho máx 480px centrado
 * vía CSS, mismo patrón visual que móvil). Secciones, en este orden:
 *  - TONO: stepper ±½ + bubble (tap = reset) + toggle ♯/♭.
 *  - NOTACIÓN: segmented control Do Re Mi / A B C (chordNotation.js).
 *  - TAMAÑO DE LETRA: A−/valor/A+.
 *  - Click del metrónomo (F4, vista inmersiva sync): toggle del click audible
 *    (Sonando/Silenciado); badge de BPM y pulso visual corren siempre que hay
 *    beats + pista sonando, independiente de este toggle (hint en la sección).
 *  - AUTO-SCROLL: −/valor/+.
 *
 * No introduce lógica nueva de dominio; es aditivo sobre los closures de
 * SongView.js (mismos handlers que la toolbar principal — una sola fuente
 * de verdad del estado).
 */

import { escapeHtml } from '../lib/escape.js';

const CLOSE_FALLBACK_MS = 200;

/** @type {{ dim: HTMLElement, sheet: HTMLElement, close: Function, update: Function } | null} */
let openEls = null;

/**
 * Abre el bottom-sheet de opciones sobre el body.
 * Idempotente: si ya hay una hoja abierta, refresca su contenido con los
 * opts nuevos (mismo nodo `.osheet`, sin animación de reapertura, listeners
 * nuevos sobre DOM nuevo = sin duplicados) y devuelve el controlador vivo —
 * mismo patrón que GoToSheet en cuanto a "una sola instancia".
 * Retorna { close, sheet } para control externo.
 *
 * @param {{
 *   showTono: boolean,
 *   tonoLabel: string,
 *   useFlats: boolean,
 *   notation: 'anglo'|'latin',
 *   fontLabel: string,
 *   autoscrollLabel: string,
 *   showAutoscroll?: boolean,
 *   modes?: Array<{value: string, label: string}>,
 *   mode?: string,
 *   voiceOptions?: Array<{value: string, label: string}>,
 *   activeVoiceCategory?: string|null,
 *   showTuner?: boolean,
 *   tunerOn?: boolean,
 *   showPlayerToggle?: boolean,
 *   playerOn?: boolean,
 *   showMetronome?: boolean,
 *   metronomeOn?: boolean,
 *   onTranspose?: (dir: 1|-1) => void,
 *   onResetTranspose?: () => void,
 *   onToggleAccidental?: () => void,
 *   onNotationChange?: (notation: 'anglo'|'latin') => void,
 *   onFont?: (dir: 1|-1) => void,
 *   onAutoscroll?: (dir: 1|-1) => string|void,
 *   onModeChange?: (mode: string) => void,
 *   onVoiceChange?: (category: string) => void,
 *   onTunerToggle?: () => void,
 *   onPlayerToggle?: (on: boolean) => void,
 *   onMetronomeToggle?: (on: boolean) => void,
 *   onClose?: () => void,
 * }} opts modes/voiceOptions/showTuner/showPlayerToggle son opcionales
 *   (T-inmersiva): sin ellos las secciones MODO/VOZ/AFINADOR/PISTA simplemente
 *   no se pintan, así que ImmersiveView/SongView (que no los pasan) quedan
 *   sin cambios de comportamiento.
 * @returns {{ close: () => void, sheet: HTMLElement }}
 */
export function openOptionsSheet(opts) {
  if (openEls) {
    openEls.update(opts);
    return { close: openEls.close, sheet: openEls.sheet };
  }
  // Reapertura rápida: retira cualquier hoja anterior aún saliendo (animación).
  document.querySelectorAll('.osheet--closing, .osheet-dim--closing').forEach((el) => el.remove());

  const dim = document.createElement('div');
  dim.className = 'osheet-dim';

  const sheet = document.createElement('div');
  sheet.className = 'osheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Opciones');
  sheet.setAttribute('tabindex', '-1');

  let current = opts;
  function renderContent(o) {
    current = o;
    sheet.innerHTML = buildSheetHtml(o);
    bindSheetHandlers(sheet, o);
  }
  renderContent(opts);

  let closed = false;
  function unmount() {
    dim.remove();
    sheet.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  function close() {
    if (closed) return;
    closed = true;
    // Se libera de inmediato para permitir reapertura durante la animación de salida.
    openEls = null;
    document.removeEventListener('keydown', onKeydown);
    current.onClose?.();

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      unmount();
      return;
    }

    dim.classList.add('osheet-dim--closing');
    sheet.classList.add('osheet--closing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unmount();
    };
    sheet.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, CLOSE_FALLBACK_MS);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeydown);

  dim.addEventListener('click', close);

  document.body.append(dim, sheet);
  sheet.focus();

  openEls = { dim, sheet, close, update: renderContent };
  return { close, sheet };
}

/**
 * Arma el HTML interno del sheet (grab handle + secciones) a partir de opts.
 * Función pura: no toca el DOM, solo devuelve el string del template.
 */
function buildSheetHtml(opts) {
  const notation = opts.notation === 'anglo' ? 'anglo' : 'latin';

  // MODO/VOZ (T-inmersiva): segmentados opcionales, arriba de TONO — solo la
  // vista inmersiva los pasa (ImmersiveView/SongView no envían `modes`/
  // `voiceOptions`, así que su sheet queda idéntico).
  const modeSectionHtml =
    Array.isArray(opts.modes) && opts.modes.length > 1
      ? `
    <div class="osheet__section">
      <div class="osheet__h syn">MODO</div>
      <div class="osheet__seg osheet__seg--mode" role="group" aria-label="Modo de contenido">
        ${opts.modes
          .map(
            (m) =>
              `<button class="osheet__seg-btn${m.value === opts.mode ? ' is-active' : ''}" data-mode="${escapeHtml(m.value)}" aria-pressed="${m.value === opts.mode}">${escapeHtml(m.label)}</button>`,
          )
          .join('')}
      </div>
    </div>`
      : '';

  const voiceSectionHtml =
    Array.isArray(opts.voiceOptions) && opts.voiceOptions.length > 0
      ? `
    <div class="osheet__section">
      <div class="osheet__h syn">VOZ</div>
      <div class="osheet__seg osheet__seg--voice" role="group" aria-label="Voz activa">
        ${opts.voiceOptions
          .map(
            (v) =>
              `<button class="osheet__seg-btn${v.value === opts.activeVoiceCategory ? ' is-active' : ''}" data-voice="${escapeHtml(v.value)}" aria-pressed="${v.value === opts.activeVoiceCategory}">${escapeHtml(v.label)}</button>`,
          )
          .join('')}
      </div>
    </div>`
      : '';

  const tonoSectionHtml = opts.showTono
    ? `
    <div class="osheet__section">
      <div class="osheet__h syn">TONO</div>
      <div class="osheet__seg">
        <button data-act="tdown" aria-label="Bajar medio tono">−½</button>
        <button class="osheet__bubble" data-act="treset" id="osheet-tono" aria-label="Tono: ${escapeHtml(opts.tonoLabel || '')}. Toca para restablecer al original.">${escapeHtml(opts.tonoLabel || '')}</button>
        <button data-act="tup" aria-label="Subir medio tono">+½</button>
        <button data-act="accidental" class="osheet__accidental" aria-label="Alternar sostenidos y bemoles">${opts.useFlats ? '♭' : '♯'}</button>
      </div>
    </div>`
    : '';

  const notationSectionHtml = `
    <div class="osheet__section">
      <div class="osheet__h syn">NOTACIÓN</div>
      <div class="osheet__seg osheet__seg--notation" role="group" aria-label="Notación de acordes">
        <button class="osheet__seg-btn${notation === 'latin' ? ' is-active' : ''}" data-notation="latin" aria-pressed="${notation === 'latin'}">Do Re Mi</button>
        <button class="osheet__seg-btn${notation === 'anglo' ? ' is-active' : ''}" data-notation="anglo" aria-pressed="${notation === 'anglo'}">A B C</button>
      </div>
    </div>`;

  const sizeSectionHtml = `
    <div class="osheet__section">
      <div class="osheet__h syn">TAMAÑO DE LETRA</div>
      <div class="osheet__seg">
        <button data-act="fdown" aria-label="Reducir tamaño de letra">A−</button>
        <span class="osheet__val" id="osheet-font">${escapeHtml(opts.fontLabel || '')}</span>
        <button data-act="fup" aria-label="Aumentar tamaño de letra">A+</button>
      </div>
    </div>`;

  // AUTO-SCROLL (VELOCIDAD en la vista inmersiva): oculto explícitamente con
  // `showAutoscroll: false` (solo aplica en modo timer allá); default true
  // preserva el comportamiento existente de ImmersiveView/SongView.
  const autoscrollSectionHtml =
    opts.showAutoscroll === false
      ? ''
      : `
    <div class="osheet__section">
      <div class="osheet__h syn">AUTO-SCROLL</div>
      <div class="osheet__seg">
        <button data-act="asdown" aria-label="Autoscroll más lento">−</button>
        <span class="osheet__val" id="osheet-autoscroll">${escapeHtml(opts.autoscrollLabel || '')}</span>
        <button data-act="asup" aria-label="Autoscroll más rápido">+</button>
      </div>
    </div>`;

  const tunerSectionHtml = opts.showTuner
    ? `
    <div class="osheet__section">
      <div class="osheet__h syn">AFINADOR</div>
      <div class="osheet__seg">
        <button class="osheet__seg-btn${opts.tunerOn ? ' is-active' : ''}" data-act="tuner-toggle" id="osheet-tuner" aria-pressed="${!!opts.tunerOn}">${opts.tunerOn ? 'Activado' : 'Desactivado'}</button>
      </div>
    </div>`
    : '';

  // PISTA (D3, flag immersive_player): toggle "Reproducir pista" — solo
  // ImmersiveView lo pasa (`showPlayerToggle: true`) cuando ya está en modo
  // sync (audio+timings listos); SongView y el resto queda sin cambios.
  const playerSectionHtml = opts.showPlayerToggle
    ? `
    <div class="osheet__section">
      <div class="osheet__h syn">PISTA</div>
      <div class="osheet__seg">
        <button class="osheet__seg-btn${opts.playerOn ? ' is-active' : ''}" data-act="player-toggle" id="osheet-player" aria-pressed="${!!opts.playerOn}">${opts.playerOn ? 'Pista: sonando' : 'Pista: en pausa'}</button>
      </div>
    </div>`
    : '';

  // METRÓNOMO (F4): toggle del click, solo visible cuando la sesión sync
  // trae rejilla de beats (`showMetronome: !!s.beatClock`) — mismo patrón
  // que PISTA/AFINADOR. El toggle SOLO controla el click audible; el badge
  // de BPM y el pulso visual corren siempre que hay beats + pista sonando
  // (guía visual pasiva, decisión de producto), de ahí la línea informativa.
  const metronomeSectionHtml = opts.showMetronome
    ? `
    <div class="osheet__section">
      <div class="osheet__h syn">Click del metrónomo</div>
      <div class="osheet__seg">
        <button class="osheet__seg-btn${opts.metronomeOn ? ' is-active' : ''}" data-act="metronome-toggle" id="osheet-metronome" aria-pressed="${!!opts.metronomeOn}">${opts.metronomeOn ? 'Sonando' : 'Silenciado'}</button>
      </div>
      <div class="osheet__hint">Guía visual activa (badge y pulso)</div>
    </div>`
    : '';

  return `
    <div class="osheet__grab"></div>
    ${modeSectionHtml}
    ${voiceSectionHtml}
    ${tonoSectionHtml}
    ${notationSectionHtml}
    ${sizeSectionHtml}
    ${tunerSectionHtml}
    ${playerSectionHtml}
    ${metronomeSectionHtml}
    ${autoscrollSectionHtml}
  `;
}

/**
 * Ata los listeners de los controles del sheet a los handlers de opts.
 * Se llama tras cada `sheet.innerHTML = buildSheetHtml(opts)`, así que
 * siempre ata sobre DOM nuevo (sin listeners duplicados de renders previos).
 */
function bindSheetHandlers(sheet, opts) {
  sheet.querySelectorAll('[data-notation]').forEach((b) =>
    b.addEventListener('click', () => {
      const value = b.dataset.notation;
      sheet.querySelectorAll('[data-notation]').forEach((x) => {
        const active = x === b;
        x.classList.toggle('is-active', active);
        x.setAttribute('aria-pressed', String(active));
      });
      opts.onNotationChange?.(value);
    }),
  );

  sheet.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'tup') opts.onTranspose?.(1);
      else if (a === 'tdown') opts.onTranspose?.(-1);
      else if (a === 'treset') opts.onResetTranspose?.();
      else if (a === 'accidental') opts.onToggleAccidental?.();
      else if (a === 'fup') opts.onFont?.(1);
      else if (a === 'fdown') opts.onFont?.(-1);
      else if (a === 'asup' || a === 'asdown') {
        const label = opts.onAutoscroll?.(a === 'asup' ? 1 : -1);
        const el = sheet.querySelector('#osheet-autoscroll');
        if (el && label !== null && label !== undefined) el.textContent = label;
      } else if (a === 'tuner-toggle') {
        const nowOn = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(nowOn));
        b.classList.toggle('is-active', nowOn);
        b.textContent = nowOn ? 'Activado' : 'Desactivado';
        opts.onTunerToggle?.(nowOn);
      } else if (a === 'player-toggle') {
        const nowOn = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(nowOn));
        b.classList.toggle('is-active', nowOn);
        b.textContent = nowOn ? 'Pista: sonando' : 'Pista: en pausa';
        opts.onPlayerToggle?.(nowOn);
      } else if (a === 'metronome-toggle') {
        const nowOn = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(nowOn));
        b.classList.toggle('is-active', nowOn);
        b.textContent = nowOn ? 'Sonando' : 'Silenciado';
        opts.onMetronomeToggle?.(nowOn);
      }
    }),
  );

  sheet.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const value = b.dataset.mode;
      sheet.querySelectorAll('[data-mode]').forEach((x) => {
        const active = x === b;
        x.classList.toggle('is-active', active);
        x.setAttribute('aria-pressed', String(active));
      });
      opts.onModeChange?.(value);
    }),
  );

  sheet.querySelectorAll('[data-voice]').forEach((b) =>
    b.addEventListener('click', () => {
      const value = b.dataset.voice;
      sheet.querySelectorAll('[data-voice]').forEach((x) => {
        const active = x === b;
        x.classList.toggle('is-active', active);
        x.setAttribute('aria-pressed', String(active));
      });
      opts.onVoiceChange?.(value);
    }),
  );
}

/**
 * Cierra la hoja de opciones si está abierta (dispara la salida animada).
 * No-op si no hay hoja abierta.
 */
export function closeOptionsSheet() {
  openEls?.close();
}

/**
 * @returns {boolean} true si la hoja de opciones está abierta.
 */
export function isOptionsSheetOpen() {
  return openEls !== null;
}
