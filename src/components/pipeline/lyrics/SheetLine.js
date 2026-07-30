/**
 * SheetLine.js — un renglón de la hoja viva de revisión de letra (S3a).
 * Factory que devuelve `div.sheet-line`; el orquestador (`LyricsSheet`, Task
 * 8) lo repinta con `update(...)` en vez de recrearlo. Reposo (Task 2): tres
 * estados — con texto, sin texto («Sin texto», confianza apagada) y
 * vocalización (itálica atenuada, sin barra de confianza). El handle de
 * arrastre se pinta pero es inerte: el gesto de reordenar es de la sesión 4.
 */
import { icon } from '../../../lib/icons.js';
import { escapeHtml } from '../../../lib/escape.js';

const EMPTY_TEXT = 'Sin texto';

/** True si el renglón tiene words alineadas y una confidence numérica —
 * únicas condiciones bajo las que se pinta la barra de confianza llena. */
function hasConfidence(line) {
  return Array.isArray(line.words) && line.words.length > 0 && typeof line.confidence === 'number';
}

/**
 * @param {{line: object, sIdx: number, lIdx: number, afterWords?: number[],
 *   suggestion?: object|null, isDudoso?: boolean, canMoveUp?: boolean,
 *   canMoveDown?: boolean, handlers: object}} opts
 * @returns {HTMLElement}
 */
export function SheetLine(opts) {
  const { sIdx, lIdx, handlers } = opts;
  let { line, afterWords, suggestion, isDudoso, canMoveUp, canMoveDown } = opts;

  const el = document.createElement('div');
  el.className = 'sheet-line';

  function render() {
    const isEmpty = !line.text;
    const isVoc = !!line.vocalization;
    el.className = [
      'sheet-line',
      isEmpty ? 'sheet-line--empty' : '',
      isVoc ? 'sheet-line--vocalization' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const confHtml = isVoc
      ? ''
      : `<span class="sheet-line__conf${hasConfidence(line) ? '' : ' sheet-line__conf--none'}"></span>`;

    el.innerHTML = `
      <span class="sheet-line__grip" aria-hidden="true">${icon('grip-vertical', { size: 12 })}</span>
      <span class="sheet-line__text">${isEmpty ? EMPTY_TEXT : escapeHtml(line.text)}</span>
      ${confHtml}
    `;

    const confEl = el.querySelector('.sheet-line__conf');
    if (confEl && hasConfidence(line)) {
      confEl.style.width = `${Math.round(line.confidence * 100)}%`;
    }
  }

  render();

  el.update = function update(next = {}) {
    if ('line' in next) line = next.line;
    if ('afterWords' in next) afterWords = next.afterWords;
    if ('suggestion' in next) suggestion = next.suggestion;
    if ('isDudoso' in next) isDudoso = next.isDudoso;
    if ('canMoveUp' in next) canMoveUp = next.canMoveUp;
    if ('canMoveDown' in next) canMoveDown = next.canMoveDown;
    render();
  };

  return el;
}
