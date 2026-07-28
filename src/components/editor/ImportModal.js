/**
 * ImportModal.js — popup "Importar letra": textarea + vista previa en vivo
 * del parseo (secciones `[Verso 1]`/`[Coro]` o directivas ChordPro).
 *
 * Extraído de SongEditor.js (F6-T3): factory sin cambio de comportamiento
 * respecto al showImportModal original. No conoce `blocks` ni el formulario
 * del editor — al confirmar entrega el resultado parseado vía `onImport`.
 */
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';
import { parseImportText } from '../../lib/importParse.js';

/**
 * Monta el popup de importación en document.body.
 * @param {{onImport: (parsed: Array & {meta?: object}) => void}} deps -
 *   `onImport` recibe el resultado de `parseImportText` (incluye `.meta` con
 *   title/artist/key/capo) cuando el usuario confirma "Importar".
 */
export function openImportModal({ onImport }) {
  const overlay = document.createElement('div');
  overlay.className = 'import-modal__overlay';
  overlay.innerHTML = `
    <div class="import-modal">
      <div class="import-modal__header">
        <h3 class="import-modal__title">${icon('download', { size: 18 })} Importar letra</h3>
        <button class="import-modal__close" id="import-close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
      </div>
      <p class="import-modal__hint">
        Pega las letras. Las secciones se detectan con <code>[Verso 1]</code>, <code>[Coro]</code>, etc.
        o con directivas ChordPro (<code>{start_of_chorus}</code>, <code>{title:}</code>...).
        Las líneas vacías separan secciones automáticamente.
      </p>
      <textarea class="import-modal__textarea" id="import-textarea" placeholder="[Verso 1]\nPrimera línea de la canción\nSegunda línea\n\n[Coro]\nEstribillo aquí..."></textarea>
      <div class="import-modal__preview" id="import-preview">
        <p class="import-modal__placeholder">La vista previa aparecerá aquí...</p>
      </div>
      <div class="import-modal__actions">
        <button class="btn btn--secondary" id="import-cancel-btn">Cancelar</button>
        <button class="btn btn--primary" id="import-confirm-btn">Importar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const textarea = overlay.querySelector('#import-textarea');
  const previewEl = overlay.querySelector('#import-preview');

  textarea.addEventListener('input', () => {
    const parsed = parseImportText(textarea.value);
    if (parsed.length === 0) {
      previewEl.innerHTML =
        '<p class="import-modal__placeholder">La vista previa aparecerá aquí...</p>';
      return;
    }
    previewEl.innerHTML = parsed
      .map(
        (block) =>
          `<div class="import-preview__section">
        <div class="import-preview__label">${escapeHtml(block.label)}</div>
        ${block.lines.map((l) => `<div class="import-preview__line">${escapeHtml(l.text)}</div>`).join('')}
      </div>`,
      )
      .join('');
  });

  overlay.querySelector('#import-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#import-cancel-btn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#import-confirm-btn').addEventListener('click', () => {
    const parsed = parseImportText(textarea.value);
    onImport(parsed);
    overlay.remove();
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  textarea.focus();
}
