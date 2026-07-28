/**
 * ChordEditorModal.js — popup "Acordes" del editor (tap inicio→tap fin sobre
 * la letra, asignar acorde por rango). Incluye la quick-chord-bar (F6-T2):
 * acordes ya usados en toda la canción, para insertar con un tap.
 *
 * Extraído de SongEditor.js (F6-T3): factory que muta `line.chords` in-place
 * y avisa por `onClose` — sin cambio de comportamiento respecto al openChordEditor
 * original.
 */
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';
import {
  createSelectionState,
  selectionRange,
  advanceSelection,
  resetSelection,
  buildCharStripHTML,
  collectUsedChords,
} from '../../lib/editorSelection.js';

/**
 * Monta el popup de Acordes en document.body. Muta `line.chords=[{ch,pos}]`.
 * @param {{chords?: Array<{pos:number,ch:string}>}} line
 * @param {{blocks: Array, onClose: () => void}} deps - `blocks` para derivar
 *   la quick-chord-bar (acordes ya usados en la canción); `onClose` se llama
 *   al cerrar el modal (el llamador re-renderiza).
 */
export function openChordEditorModal(line, { blocks, onClose }) {
  if (!Array.isArray(line.chords)) line.chords = [];
  const overlay = document.createElement('div');
  overlay.className = 'import-modal__overlay';
  document.body.appendChild(overlay);
  // Modal persistente: render() solo actualiza su contenido, así la animación
  // de entrada (modalIn) no se reproduce en cada interacción.
  const modalEl = document.createElement('div');
  modalEl.className = 'import-modal tono-editor';
  overlay.appendChild(modalEl);

  const sel = createSelectionState();
  let chordDraft = '';

  const close = () => {
    overlay.remove();
    onClose();
  };
  const currentRange = () => selectionRange(sel);
  const setChord = (pos, ch) => {
    const clean = (ch || '').trim();
    const existing = line.chords.find((c) => c.pos === pos);
    if (!clean) {
      line.chords = line.chords.filter((c) => c.pos !== pos);
    } else if (existing) {
      existing.ch = clean;
    } else {
      line.chords.push({ ch: clean, pos });
    }
    line.chords.sort((a, b) => a.pos - b.pos);
  };

  function render() {
    const text = line.text || '';
    const range = currentRange();
    const strip = buildCharStripHTML(text, range);
    const pos = range ? range.start : null;
    const existing = pos === null ? null : line.chords.find((c) => c.pos === pos);

    const chordRows =
      line.chords.length === 0
        ? '<p class="tono-editor__hint">Aún no hay acordes en esta línea.</p>'
        : line.chords
            .map((c) => {
              const at = escapeHtml(text.slice(c.pos, c.pos + 1)) || '⌑';
              return `<div class="group-row">
                <span class="group-row__seg">${escapeHtml(c.ch)}</span>
                <span class="group-row__voice">en "${at}" (pos ${c.pos})</span>
                <button class="group-row__del" data-del-pos="${c.pos}" type="button" aria-label="Quitar acorde">${icon('trash', { size: 14 })}</button>
              </div>`;
            })
            .join('');

    const canAdd = pos !== null;
    const usedChords = collectUsedChords(blocks);
    const quickBarHtml =
      usedChords.length === 0
        ? ''
        : `<div class="quick-chord-bar">
            <span class="quick-chord-bar__label">Acordes usados</span>
            <div class="quick-chord-bar__chips">
              ${usedChords
                .map(
                  (ch) =>
                    `<button class="quick-chord-bar__chip" data-quick-chord="${escapeHtml(ch)}" type="button"${canAdd ? '' : ' disabled'}>${escapeHtml(ch)}</button>`,
                )
                .join('')}
            </div>
          </div>`;
    modalEl.innerHTML = `
        <div class="import-modal__header">
          <h3 class="import-modal__title">${icon('audio-lines', { size: 18 })} Acordes</h3>
          <button class="import-modal__close" data-chord="close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
        </div>

        <div class="tono-editor__step">
          <div class="tono-editor__step-head"><span>1 · Toca dónde empieza el acorde</span></div>
          <div class="char-strip">${strip}</div>
        </div>

        <div class="tono-editor__step">
          <div class="tono-editor__step-head"><span>2 · Acorde</span></div>
          ${quickBarHtml}
          <div class="chord-editor__assign">
            <input class="form-group__input" data-chord="input" type="text" value="${escapeHtml(chordDraft || existing?.ch || '')}" placeholder="Ej: Am, F#m, G7" />
            <button class="btn btn--primary" data-chord="apply" type="button"${canAdd ? '' : ' disabled'}>${icon('plus', { size: 14 })} Guardar</button>
          </div>
        </div>

        <div class="tono-editor__step">
          <div class="tono-editor__step-head"><span>Acordes de la línea</span></div>
          <div class="group-list">${chordRows}</div>
        </div>

        <div class="import-modal__actions">
          <button class="btn btn--primary" data-chord="done" type="button">Listo</button>
        </div>`;
  }

  overlay.addEventListener('input', (e) => {
    if (e.target.dataset.chord === 'input') chordDraft = e.target.value;
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close();
    const act = e.target.closest('[data-chord]')?.dataset.chord;
    if (act === 'close' || act === 'done') return close();
    if (act === 'apply') {
      const range = currentRange();
      if (!range) return;
      setChord(range.start, chordDraft);
      resetSelection(sel);
      chordDraft = '';
      render();
      return;
    }
    const quickBtn = e.target.closest('[data-quick-chord]');
    if (quickBtn) {
      const range = currentRange();
      if (!range) return;
      setChord(range.start, quickBtn.dataset.quickChord);
      resetSelection(sel);
      chordDraft = '';
      render();
      return;
    }
    const delBtn = e.target.closest('[data-del-pos]');
    if (delBtn) {
      const p = Number.parseInt(delBtn.dataset.delPos, 10);
      if (!Number.isNaN(p)) {
        setChord(p, '');
        render();
      }
      return;
    }
    const charBtn = e.target.closest('.char-cell');
    if (charBtn) {
      const i = Number.parseInt(charBtn.dataset.char, 10);
      if (Number.isNaN(i)) return;
      advanceSelection(sel, i);
      chordDraft = '';
      render();
    }
  });

  render();
}
