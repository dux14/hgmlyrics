/**
 * ConfirmDialog.js — diálogo de confirmación reusable. Reusa el patrón de
 * modal del editor (`.import-modal__overlay` / `.import-modal`, ver
 * src/components/editor/TonoEditorModal.js) en vez de crear lenguaje visual
 * nuevo.
 */
import { escapeHtml } from '../lib/escape.js';

/**
 * Muestra un diálogo de confirmación modal.
 * @param {{title: string, body: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>} true si el usuario confirma, false si cancela/Escape/click fuera.
 */
export function confirmDialog({
  title,
  body,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
}) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'import-modal__overlay';
    overlay.innerHTML = `
      <div class="import-modal">
        <div class="import-modal__header">
          <h3 class="import-modal__title">${escapeHtml(title)}</h3>
        </div>
        <p class="import-modal__hint"></p>
        <div class="import-modal__actions">
          <button class="btn btn--secondary" data-confirm="no" type="button">${escapeHtml(cancelLabel)}</button>
          <button class="btn ${danger ? 'btn--secondary btn--danger' : 'btn--primary'}" data-confirm="yes" type="button">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    overlay.querySelector('.import-modal__hint').textContent = body;

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector('[data-confirm="no"]');
    const confirmBtn = overlay.querySelector('[data-confirm="yes"]');

    function cleanup(result) {
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('hashchange', onNavigate);
      window.removeEventListener('popstate', onNavigate);
      overlay.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') cleanup(false);
    }

    // Si el usuario navega (back del navegador, hashchange) con el diálogo
    // abierto, el overlay no debe sobrevivir montado sobre la pantalla siguiente.
    function onNavigate() {
      cleanup(false);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
    cancelBtn.addEventListener('click', () => cleanup(false));
    confirmBtn.addEventListener('click', () => cleanup(true));
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);

    cancelBtn.focus();
  });
}
