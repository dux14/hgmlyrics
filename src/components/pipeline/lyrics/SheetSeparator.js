/**
 * SheetSeparator.js — separador insertable entre dos renglones de la hoja
 * viva de revisión de letra (S3a, Task 4). Reemplaza el par de botones
 * apilados «Unir con el siguiente renglón» / «Dividir aquí» del panel viejo:
 * ese par no se porta.
 *
 * A la izquierda, un `+` que inserta un renglón vacío justo después de
 * `afterLine` (el orquestador, `SheetSection.focusLine` en Task 5, abre ese
 * renglón nuevo en edición cuando la acción vuelve — acá solo se despacha).
 * A la derecha, «cortar sección aquí» parte la sección en dos, dejando
 * `afterLine` como último renglón de la mitad de arriba.
 */
import { icon } from '../../../lib/icons.js';

/**
 * @param {{sIdx: number, afterLine: number, handlers: object}} opts
 * @returns {HTMLElement}
 */
export function SheetSeparator({ sIdx, afterLine, handlers }) {
  const el = document.createElement('div');
  el.className = 'sheet-separator';

  el.innerHTML = `
    <button type="button" class="sheet-separator__add" aria-label="Insertar renglón">${icon('plus', { size: 12 })}</button>
    <button type="button" class="sheet-separator__split">cortar sección aquí</button>
  `;

  const addBtn = el.querySelector('.sheet-separator__add');
  const splitBtn = el.querySelector('.sheet-separator__split');

  addBtn.disabled = handlers.isBusy();
  splitBtn.disabled = handlers.isBusy();

  addBtn.addEventListener('click', () => {
    if (handlers.isBusy()) return;
    handlers.runAction({ type: 'insertLine', section: sIdx, at: afterLine + 1 }, { rowEl: el });
  });

  splitBtn.addEventListener('click', () => {
    if (handlers.isBusy()) return;
    handlers.runAction({ type: 'splitSection', section: sIdx, afterLine }, { rowEl: el });
  });

  return el;
}
