/**
 * OptionsSheet.js — Bottom-sheet "Opciones" unificado (T4, evoluciona VoiceSheet.js).
 *
 * Disponible en TODAS las resoluciones (en desktop: ancho máx 480px centrado
 * vía CSS, mismo patrón visual que móvil). Secciones:
 *  - VOCES VISIBLES: una fila por voz del roster (no por categoría) con punto
 *    de color, nombre, registro (referenceKey) y switch de visibilidad.
 *  - TONO: stepper ±½ + bubble (tap = reset) + toggle ♯/♭.
 *  - NOTACIÓN: segmented control Do Re Mi / A B C (chordNotation.js).
 *  - TAMAÑO: A−/valor/A+.
 *  - VELOCIDAD (autoscroll): −/valor/+.
 *
 * No introduce lógica nueva de dominio; es aditivo sobre los closures de
 * SongView.js (mismos handlers que la toolbar principal — una sola fuente
 * de verdad del estado).
 */

import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';

const ORDER = ['soprano', 'contralto', 'tenor', 'bass'];

/**
 * Filas de VOCES VISIBLES: una por voz del roster (no colapsada por
 * categoría), ordenadas SATB. Cada fila trae lo necesario para pintar punto
 * de color + nombre + registro.
 * @param {object|null} song
 * @returns {{ id: string, category: string, colorVar: string, name: string, referenceKey: string|null }[]}
 */
export function buildVoiceOptionRows(song) {
  const roster = Array.isArray(song?.voiceRoster) ? song.voiceRoster : [];
  return [...roster]
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category))
    .map((v) => ({
      id: v.id,
      category: v.category,
      colorVar: `--color-voice-${v.category}`,
      name: v.name,
      referenceKey: v.referenceKey || null,
    }));
}

/**
 * Abre el bottom-sheet de opciones sobre el body.
 * Retorna { close, sheet } para control externo.
 *
 * @param {{
 *   song: object,
 *   visibleVoices: Set<string>,
 *   showTono: boolean,
 *   tonoLabel: string,
 *   useFlats: boolean,
 *   notation: 'anglo'|'latin',
 *   fontLabel: string,
 *   autoscrollLabel: string,
 *   onToggleVoice?: (voiceId: string) => void,
 *   onTranspose?: (dir: 1|-1) => void,
 *   onResetTranspose?: () => void,
 *   onToggleAccidental?: () => void,
 *   onNotationChange?: (notation: 'anglo'|'latin') => void,
 *   onFont?: (dir: 1|-1) => void,
 *   onAutoscroll?: (dir: 1|-1) => string|void,
 *   onClose?: () => void,
 * }} opts
 * @returns {{ close: () => void, sheet: HTMLElement }}
 */
export function openOptionsSheet(opts) {
  const rows = buildVoiceOptionRows(opts.song);
  const visibleVoices = opts.visibleVoices instanceof Set ? opts.visibleVoices : new Set();
  const notation = opts.notation === 'anglo' ? 'anglo' : 'latin';

  const dim = document.createElement('div');
  dim.className = 'osheet-dim';

  const sheet = document.createElement('div');
  sheet.className = 'osheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Opciones');
  sheet.setAttribute('tabindex', '-1');

  const voicesSectionHtml = rows.length
    ? `
    <div class="osheet__section">
      <div class="osheet__h syn">Voces visibles</div>
      <div class="osheet__voices">
        ${rows
          .map((r) => {
            const on = visibleVoices.has(r.id);
            return `
            <div class="osheet__voice-row">
              <span class="osheet__dot" style="background: var(${r.colorVar})"></span>
              <span class="osheet__voice-info">
                <span class="osheet__voice-name">${escapeHtml(r.name)}</span>
                ${r.referenceKey ? `<span class="osheet__voice-ref">${escapeHtml(r.referenceKey)}</span>` : ''}
              </span>
              <button
                class="osheet__switch${on ? ' is-on' : ''}"
                type="button"
                role="switch"
                aria-checked="${on}"
                data-voice-id="${r.id}"
                aria-label="Mostrar ${escapeHtml(r.name)}"
              ><span class="osheet__switch-knob"></span></button>
            </div>`;
          })
          .join('')}
      </div>
    </div>`
    : '';

  const tonoSectionHtml = opts.showTono
    ? `
    <div class="osheet__section">
      <div class="osheet__h syn">Tono</div>
      <div class="osheet__seg">
        <button data-act="tdown" aria-label="Bajar medio tono">${icon('chevron-left', { size: 16 })}</button>
        <button class="osheet__bubble" data-act="treset" id="osheet-tono" aria-label="Tono: ${escapeHtml(opts.tonoLabel || '')}. Toca para restablecer al original.">${escapeHtml(opts.tonoLabel || '')}</button>
        <button data-act="tup" aria-label="Subir medio tono" style="transform: rotate(180deg)">${icon('chevron-left', { size: 16 })}</button>
        <button data-act="accidental" class="osheet__accidental" aria-label="Alternar sostenidos y bemoles">${opts.useFlats ? '♭' : '♯'}</button>
      </div>
    </div>`
    : '';

  const notationSectionHtml = `
    <div class="osheet__section">
      <div class="osheet__h syn">Notación</div>
      <div class="osheet__seg osheet__seg--notation" role="group" aria-label="Notación de acordes">
        <button class="osheet__seg-btn${notation === 'latin' ? ' is-active' : ''}" data-notation="latin" aria-pressed="${notation === 'latin'}">Do Re Mi</button>
        <button class="osheet__seg-btn${notation === 'anglo' ? ' is-active' : ''}" data-notation="anglo" aria-pressed="${notation === 'anglo'}">A B C</button>
      </div>
    </div>`;

  const sizeSectionHtml = `
    <div class="osheet__section">
      <div class="osheet__h syn">Tamaño</div>
      <div class="osheet__seg">
        <button data-act="fdown" aria-label="Reducir tamaño de letra">A−</button>
        <span class="osheet__val" id="osheet-font">${escapeHtml(opts.fontLabel || '')}</span>
        <button data-act="fup" aria-label="Aumentar tamaño de letra">A+</button>
      </div>
    </div>`;

  const autoscrollSectionHtml = `
    <div class="osheet__section">
      <div class="osheet__h syn">Velocidad</div>
      <div class="osheet__seg">
        <button data-act="asdown" aria-label="Autoscroll más lento">−</button>
        <span class="osheet__val" id="osheet-autoscroll">${escapeHtml(opts.autoscrollLabel || '')}</span>
        <button data-act="asup" aria-label="Autoscroll más rápido">+</button>
      </div>
    </div>`;

  sheet.innerHTML = `
    <div class="osheet__grab"></div>
    ${voicesSectionHtml}
    ${tonoSectionHtml}
    ${notationSectionHtml}
    ${sizeSectionHtml}
    ${autoscrollSectionHtml}
  `;

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  function close() {
    document.removeEventListener('keydown', onKeydown);
    dim.remove();
    sheet.remove();
    opts.onClose?.();
  }

  dim.addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);

  sheet.querySelectorAll('[data-voice-id]').forEach((b) =>
    b.addEventListener('click', () => {
      const nowOn = !b.classList.contains('is-on');
      b.classList.toggle('is-on', nowOn);
      b.setAttribute('aria-checked', String(nowOn));
      opts.onToggleVoice?.(b.dataset.voiceId);
    }),
  );

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
      }
    }),
  );

  document.body.append(dim, sheet);
  sheet.focus();

  return { close, sheet };
}
