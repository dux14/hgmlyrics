/**
 * VoiceBottomSheet.js — Sticky bottom-sheet UI for assigning voices to a text range.
 */
import { VOICE_GROUPS, getVoiceColor, getVoiceBgColor } from '../lib/voiceSystem.js';
import { icon } from '../lib/icons.js';

/**
 * Render a sticky bottom sheet for voice picking.
 * Singleton: any prior sheet is removed before rendering a new one.
 *
 * @param {Object} opts
 * @param {string} opts.selectedText  Text snippet displayed in the label
 * @param {string[]} opts.initialVoices  Pre-checked voice IDs
 * @param {(voices: string[]) => void} opts.onApply   Called with final voice array
 * @param {() => void} opts.onRemove   Called when user clicks Quitar
 * @param {() => void} [opts.onCancel] Called when user closes without apply
 * @returns {() => void} dispose function
 */
export function openVoiceBottomSheet({ selectedText, initialVoices, onApply, onRemove, onCancel }) {
  closeAnyOpenSheet();

  const sheet = document.createElement('div');
  sheet.className = 'voice-bottom-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Asignar voces');

  const draft = new Set(initialVoices || []);

  function renderChips() {
    return VOICE_GROUPS.flatMap((g) => g.voices)
      .map((v) => {
        const active = draft.has(v.id);
        const style = active
          ? `background: ${getVoiceBgColor(v.id)}; color: ${getVoiceColor(v.id)}; border-color: ${getVoiceColor(v.id)};`
          : '';
        return `<button class="voice-bottom-sheet__chip${active ? ' voice-bottom-sheet__chip--active' : ''}"
          data-voice-id="${v.id}" style="${style}">${v.label}${active ? ` ${icon('check', { size: 14 })}` : ''}</button>`;
      })
      .join('');
  }

  function render() {
    const truncated = selectedText.length > 24 ? selectedText.slice(0, 24) + '…' : selectedText;
    sheet.innerHTML = `
      <div class="voice-bottom-sheet__label">Asignar a "${escapeHtml(truncated)}"</div>
      <div class="voice-bottom-sheet__chips">${renderChips()}</div>
      <div class="voice-bottom-sheet__actions">
        <button class="voice-bottom-sheet__btn voice-bottom-sheet__btn--primary" data-act="apply">Aplicar</button>
        <button class="voice-bottom-sheet__btn" data-act="remove">Quitar</button>
        <button class="voice-bottom-sheet__btn voice-bottom-sheet__btn--icon" data-act="close" aria-label="Cancelar">${icon('close', { size: 18 })}</button>
      </div>
    `;
  }

  function dispose() {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onOutside, true);
    sheet.remove();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      dispose();
      onCancel?.();
    }
  }

  function onOutside(e) {
    if (!sheet.contains(e.target)) {
      dispose();
      onCancel?.();
    }
  }

  sheet.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-voice-id]');
    if (chip) {
      const id = chip.dataset.voiceId;
      if (draft.has(id)) draft.delete(id);
      else draft.add(id);
      render();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'apply') {
      const out = Array.from(draft);
      dispose();
      onApply(out);
    } else if (act === 'remove') {
      dispose();
      onRemove();
    } else if (act === 'close') {
      dispose();
      onCancel?.();
    }
  });

  render();
  document.body.appendChild(sheet);
  document.addEventListener('keydown', onKey);
  // Defer outside listener so the opening tap doesn't immediately close it
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  return dispose;
}

function closeAnyOpenSheet() {
  document.querySelectorAll('.voice-bottom-sheet').forEach((el) => el.remove());
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
