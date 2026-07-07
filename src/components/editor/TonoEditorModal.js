/**
 * TonoEditorModal.js — popup "Voces y tono" del editor (v2, gated por
 * voz_tono). Flujo: 1) tap inicio→tap fin sobre las letras (rango de
 * caracteres), 2) elegir voz del roster, 3) escribir nota a mano (validada,
 * opcional), 4) "Agregar grupo". Lista de grupos con borrar. Muta line.groups.
 *
 * Extraído de SongEditor.js (F6-T3): factory sin cambio de comportamiento
 * respecto al openTonoEditor original.
 */
import { icon } from '../../lib/icons.js';
import { escapeHtml } from '../../lib/escape.js';
import { getVoiceLabel, isValidNote } from '../../lib/voiceSystem.js';
import {
  createSelectionState,
  selectionRange,
  advanceSelection,
  buildCharStripHTML,
  deleteGroupAt,
  applyGroupsForRange,
} from '../../lib/editorSelection.js';

/**
 * Monta el popup de Voces y tono en document.body. Muta `line.groups`.
 * @param {{groups?: Array, text?: string}} line
 * @param {{voiceRoster: Array<{id:string,name?:string,category:string}>, onClose: () => void}} deps
 */
export function openTonoEditorModal(line, { voiceRoster, onClose }) {
  if (!Array.isArray(line.groups)) line.groups = [];

  const sel = createSelectionState();
  let perVoice = {}; // voiceId → { included, note, invalid }
  let formError = '';

  const overlay = document.createElement('div');
  overlay.className = 'import-modal__overlay';
  document.body.appendChild(overlay);
  // El modal se crea UNA vez; render() solo actualiza su contenido (evita que
  // la animación de entrada se reproduzca en cada interacción).
  const modalEl = document.createElement('div');
  modalEl.className = 'import-modal tono-editor';
  overlay.appendChild(modalEl);

  function close() {
    overlay.remove();
    onClose();
  }

  function currentRange() {
    return selectionRange(sel);
  }

  function rosterVoice(id) {
    return voiceRoster.find((v) => v.id === id) || null;
  }

  // Siembra el estado por voz desde los grupos que coinciden con el rango actual.
  function seedPerVoice() {
    const range = currentRange();
    const map = {};
    for (const v of voiceRoster) {
      const g = range
        ? line.groups.find(
            (x) => x.start === range.start && x.end === range.end && x.voiceId === v.id,
          )
        : null;
      const note = g && g.note !== null && g.note !== undefined ? g.note : '';
      map[v.id] = { included: !!g, note, invalid: false };
    }
    return map;
  }

  function render() {
    const text = line.text || '';
    const range = currentRange();
    const strip = buildCharStripHTML(text, range);

    const voiceRows =
      voiceRoster.length === 0
        ? '<p class="tono-editor__hint">Añade voces en el roster (arriba) para asignar.</p>'
        : voiceRoster
            .map((v) => {
              const st = perVoice[v.id] || { included: false, note: '', invalid: false };
              const on = st.included;
              return `<div class="voice-note-row">
                <button class="voice-pick${on ? ' voice-pick--active' : ''}" data-voice="${v.id}" type="button" aria-pressed="${on}">
                  <span class="voice-pick__dot" style="--current-voice: var(--color-voice-${v.category})"></span>
                  ${escapeHtml(v.name || getVoiceLabel(v.category))}
                </button>
                <input class="form-group__input voice-note-row__note${st.invalid ? ' form-group__input--invalid' : ''}" data-note-for="${v.id}" type="text" value="${escapeHtml(st.note)}" placeholder="Ej: B3 (vacío = sin nota)" aria-invalid="${st.invalid}" />
              </div>`;
            })
            .join('');

    const groupRows =
      line.groups.length === 0
        ? '<p class="tono-editor__hint">Aún no hay grupos en esta línea.</p>'
        : line.groups
            .map((g, i) => {
              const v = rosterVoice(g.voiceId);
              const cat = v?.category || 'soprano';
              const vname = v ? escapeHtml(v.name || getVoiceLabel(v.category)) : '(voz eliminada)';
              const seg = escapeHtml(text.slice(g.start, g.end)) || '·';
              const noteHtml =
                g.note === null || g.note === undefined || g.note === ''
                  ? `<span class="group-row__note group-row__note--pending voice-text--${cat}">—</span>`
                  : `<span class="group-row__note">${escapeHtml(g.note)}</span>`;
              return `<div class="group-row">
                <span class="group-row__seg">${seg}</span>
                <span class="group-row__voice"><span class="voice-pick__dot" style="--current-voice: var(--color-voice-${cat})"></span>${vname}</span>
                ${noteHtml}
                <button class="group-row__del" data-del-idx="${i}" type="button" aria-label="Eliminar grupo">${icon('trash', { size: 14 })}</button>
              </div>`;
            })
            .join('');

    modalEl.innerHTML = `
        <div class="import-modal__header">
          <h3 class="import-modal__title">${icon('music', { size: 18 })} Voces y tono</h3>
          <button class="import-modal__close" data-tono="close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
        </div>

        <div class="tono-editor__step">
          <div class="tono-editor__step-head"><span>1 · Toca el inicio y el fin del rango</span></div>
          <div class="char-strip">${strip}</div>
        </div>

        <div class="tono-editor__step">
          <div class="tono-editor__step-head"><span>2 · Notas por voz (vacío = esa voz no canta el rango)</span></div>
          <div class="voice-note-grid">${voiceRows}</div>
          <button class="btn btn--primary btn--icon tono-editor__apply-btn" data-tono="apply" type="button"${range ? '' : ' disabled'}>${icon('plus', { size: 14 })} Agregar grupos del rango</button>
          ${formError ? `<p class="tono-editor__error" role="alert">${escapeHtml(formError)}</p>` : ''}
        </div>

        <div class="tono-editor__step">
          <div class="tono-editor__step-head"><span>Grupos de la línea</span></div>
          <div class="group-list">${groupRows}</div>
        </div>

        <div class="import-modal__actions">
          <button class="btn btn--primary" data-tono="done" type="button">Listo</button>
        </div>`;
  }

  // Escribir una nota actualiza el estado SIN re-render (preserva el caret) y
  // auto-incluye la voz; el chip se actualiza directamente por DOM.
  overlay.addEventListener('input', (e) => {
    const id = e.target.dataset.noteFor;
    if (!id || !perVoice[id]) return;
    perVoice[id].note = e.target.value;
    perVoice[id].invalid = false;
    if (e.target.value.trim() !== '') perVoice[id].included = true;
    const chip = overlay.querySelector(`.voice-pick[data-voice="${id}"]`);
    if (chip) {
      chip.classList.toggle('voice-pick--active', perVoice[id].included);
      chip.setAttribute('aria-pressed', String(perVoice[id].included));
    }
    e.target.classList.remove('form-group__input--invalid');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close();
    const tono = e.target.closest('[data-tono]')?.dataset.tono;
    if (tono === 'close' || tono === 'done') return close();
    if (tono === 'apply') {
      const range = currentRange();
      if (!range) return;
      let bad = false;
      for (const v of voiceRoster) {
        const st = perVoice[v.id];
        const raw = st ? st.note.trim() : '';
        if (st && st.included && raw !== '' && !isValidNote(raw)) {
          st.invalid = true;
          bad = true;
        }
      }
      if (bad) {
        formError = 'Corrige las notas inválidas (notación científica, ej: B3).';
        render();
        return;
      }
      formError = '';
      const perVoiceArray = voiceRoster.map((v) => {
        const st = perVoice[v.id] || { included: false, note: '' };
        const raw = st.note.trim();
        return { voiceId: v.id, included: st.included, note: raw === '' ? null : raw };
      });
      line.groups = applyGroupsForRange(line.groups, range, perVoiceArray);
      sel.anchor = null;
      sel.focus = null;
      perVoice = seedPerVoice();
      render();
      return;
    }
    const voiceBtn = e.target.closest('[data-voice]');
    if (voiceBtn) {
      const id = voiceBtn.dataset.voice;
      if (perVoice[id]) {
        perVoice[id].included = !perVoice[id].included;
        render();
      }
      return;
    }
    const delBtn = e.target.closest('[data-del-idx]');
    if (delBtn) {
      const i = Number.parseInt(delBtn.dataset.delIdx, 10);
      if (!Number.isNaN(i)) {
        line.groups = deleteGroupAt(line.groups, i);
        perVoice = seedPerVoice();
        render();
      }
      return;
    }
    const charBtn = e.target.closest('.char-cell');
    if (charBtn) {
      const i = Number.parseInt(charBtn.dataset.char, 10);
      if (Number.isNaN(i)) return;
      advanceSelection(sel, i);
      perVoice = seedPerVoice();
      render();
    }
  });

  perVoice = seedPerVoice();
  render();
}
