/**
 * VoiceSheet.js — Bottom-sheet "Control de voces" (solo movil, <768px)
 *
 * Materializa controles ya existentes del lector en un sheet modal:
 * - Chips de categoría de voz (single-select, via selectCategory)
 * - Segmento de tono: semitonos ♭/♯ y notacion
 * - Segmento de tamaño de fuente A−/A+
 *
 * No introduce logica nueva; es aditivo sobre los closures de SongView.js.
 */

import { icon } from '../lib/icons.js';

const ORDER = ['soprano', 'contralto', 'tenor', 'bass'];
const LABEL = { soprano: 'Soprano', contralto: 'Contralto', tenor: 'Tenor', bass: 'Bajo' };

/**
 * Devuelve las categorias presentes en el roster, en orden canonico SATB,
 * sin duplicados, con label y colorVar para cada una.
 * @param {object|null} song
 * @returns {{ category: string, label: string, colorVar: string }[]}
 */
export function buildVoiceRows(song) {
  const present = new Set((song?.voiceRoster || []).map((v) => v.category));
  return ORDER.filter((c) => present.has(c)).map((c) => ({
    category: c,
    label: LABEL[c],
    colorVar: `--color-voice-${c}`,
  }));
}

/**
 * Abre el bottom-sheet de control de voces sobre el body.
 * Retorna { close, sheet } para control externo.
 *
 * @param {{
 *   song: object,
 *   activeCategory: string|null,
 *   transposeValue: number,
 *   useFlats: boolean,
 *   fontLabel: string,
 *   onSelectCategory?: (cat: string) => void,
 *   onTranspose?: (dir: 1|-1) => void,
 *   onToggleNotation?: () => void,
 *   onFont?: (dir: 1|-1) => void,
 *   onClose?: () => void,
 * }} opts
 * @returns {{ close: () => void, sheet: HTMLElement }}
 */
export function openVoiceSheet(opts) {
  const rows = buildVoiceRows(opts.song);

  const dim = document.createElement('div');
  dim.className = 'vsheet-dim';

  const sheet = document.createElement('div');
  sheet.className = 'vsheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Control de voces');

  sheet.innerHTML = `
    <div class="vsheet__grab"></div>
    <div class="vsheet__h syn">Voz</div>
    <div class="vsheet__rows">
      ${rows
        .map(
          (r) =>
            `<button class="vsheet__row${r.category === opts.activeCategory ? ' is-active' : ''}" data-cat="${r.category}">
              <span class="vsheet__dot" style="background: var(${r.colorVar})"></span>
              <span class="vsheet__nm">${r.label}</span>
            </button>`,
        )
        .join('')}
    </div>
    <div class="vsheet__tools">
      <div class="vsheet__grp">
        <div class="vsheet__tl syn">Tono</div>
        <div class="vsheet__seg">
          <button data-act="tdown">${icon('chevron-left', { size: 16 })}</button>
          <span class="vsheet__val" id="vsheet-tono">${opts.transposeValue}</span>
          <button data-act="tup" style="transform: rotate(180deg)">${icon('chevron-left', { size: 16 })}</button>
          <button data-act="notation" class="vsheet__notation">${opts.useFlats ? '♭' : '♯'}</button>
        </div>
      </div>
      <div class="vsheet__grp">
        <div class="vsheet__tl syn">Tamaño</div>
        <div class="vsheet__seg">
          <button data-act="fdown">A−</button>
          <span class="vsheet__val" id="vsheet-font">${opts.fontLabel}</span>
          <button data-act="fup">A+</button>
        </div>
      </div>
    </div>
  `;

  function close() {
    dim.remove();
    sheet.remove();
    opts.onClose?.();
  }

  dim.addEventListener('click', close);

  sheet.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => {
      sheet
        .querySelectorAll('[data-cat]')
        .forEach((x) => x.classList.toggle('is-active', x === b));
      opts.onSelectCategory?.(b.dataset.cat);
    }),
  );

  sheet.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'tup') opts.onTranspose?.(1);
      else if (a === 'tdown') opts.onTranspose?.(-1);
      else if (a === 'notation') opts.onToggleNotation?.();
      else if (a === 'fup') opts.onFont?.(1);
      else if (a === 'fdown') opts.onFont?.(-1);
    }),
  );

  document.body.append(dim, sheet);

  return { close, sheet };
}
