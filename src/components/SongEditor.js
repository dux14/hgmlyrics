/**
 * SongEditor.js — Block-based Song Editor
 *
 * Visual block editor (Notion/Worship Tools style) for creating and editing songs.
 * Features: section blocks, line rows, voice assignment (line + word-level),
 * chord editor (UltimateGuitar style), import modal, and live preview.
 */

import { fetchSongDetail, refreshData } from '../lib/store.js';
import { renderLogoutButton } from './AdminGate.js';
import { navigate } from '../router.js';
import { getToken } from '../lib/auth.js';
import {
  VOICE_GROUPS,
  VOICE_TYPES,
  VALID_VOICE_IDS,
  getVoiceColor,
  getVoiceBgColor,
  getVoiceLabel,
  buildHighlightedHTML,
} from '../lib/voiceSystem.js';

const API_URL = '/api';

const SECTION_TYPES = [
  { type: 'verse', label: 'Verso' },
  { type: 'chorus', label: 'Coro' },
  { type: 'bridge', label: 'Puente' },
  { type: 'prechorus', label: 'Pre-Coro' },
  { type: 'intro', label: 'Intro' },
  { type: 'outro', label: 'Outro' },
];

/* ─── Data conversion helpers ─── */

/**
 * Convert song sections from DB to editable block structure
 */
function sectionsToBlocks(sections) {
  if (!sections || !Array.isArray(sections)) return [];
  return sections.map((section, si) => ({
    id: `section-${si}-${Date.now()}`,
    type: section.type || 'verse',
    label: section.label || 'Verso',
    voices: section.voices || [],
    lines: section.lines.map((line, li) => ({
      id: `line-${si}-${li}-${Date.now()}`,
      text: line.text || '',
      voices: line.voices || [],
      voiceRanges: line.voiceRanges || [],
      chords: line.chords || [],
      color: line.color || null,
      showChords: (line.chords && line.chords.length > 0),
    })),
  }));
}

/**
 * Convert editable blocks back to sections JSON for saving
 */
function blocksToSections(blocks) {
  return blocks.map(block => {
    const section = {
      type: block.type,
      label: block.label,
      lines: block.lines
        .filter(l => l.text.trim() !== '' || l.chords.length > 0)
        .map(l => {
          const line = { text: l.text };
          if (l.voices && l.voices.length > 0) line.voices = l.voices;
          if (l.voiceRanges && l.voiceRanges.length > 0) line.voiceRanges = l.voiceRanges;
          if (l.chords && l.chords.length > 0) line.chords = l.chords;
          if (l.color) line.color = l.color;
          return line;
        }),
    };
    if (block.voices && block.voices.length > 0) section.voices = block.voices;
    return section;
  });
}

/**
 * Parse imported plain text into block structure
 */
function parseImportText(text) {
  const blocks = [];
  const rawLines = text.split('\n');
  let current = null;
  let sectionCounter = 0;

  for (const rawLine of rawLines) {
    const sectionMatch = rawLine.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (current) blocks.push(current);
      const label = sectionMatch[1];
      current = {
        id: `section-imp-${sectionCounter++}-${Date.now()}`,
        type: guessType(label),
        label,
        voices: [],
        lines: [],
      };
    } else if (rawLine.trim() === '') {
      // Blank line — if we have no current section and have accumulated lines, push as new section
      if (current && current.lines.length > 0) {
        blocks.push(current);
        current = null;
      }
    } else {
      if (!current) {
        current = {
          id: `section-imp-${sectionCounter++}-${Date.now()}`,
          type: 'verse',
          label: `Verso ${sectionCounter}`,
          voices: [],
          lines: [],
        };
      }

      // Parse voice tags
      let line = rawLine;
      let voices = [];
      const voiceMatch = line.match(/^\{@([a-z,]+)\}/);
      if (voiceMatch) {
        voices = voiceMatch[1].split(',').filter(v => VALID_VOICE_IDS.includes(v));
        line = line.slice(voiceMatch[0].length);
      }

      // Parse color prefix
      let color = null;
      const colorMatch = line.match(/^\{(#[A-Fa-f0-9]{3,8})\}(.*)$/);
      if (colorMatch) {
        color = colorMatch[1];
        line = colorMatch[2];
      }

      // Parse inline chords
      const { text: cleanText, chords } = parseLineChords(line);

      current.lines.push({
        id: `line-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: cleanText,
        voices,
        voiceRanges: [],
        chords: chords || [],
        color,
        showChords: (chords && chords.length > 0),
      });
    }
  }

  if (current && current.lines.length > 0) blocks.push(current);
  return blocks;
}

/**
 * Parse inline chords [Am]text [F]text → { text, chords }
 */
function parseLineChords(lineText) {
  const chords = [];
  let cleanText = '';
  const regex = /\[([A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?[0-9]?(?:\/[A-G][#b]?)?)\]/g;
  let lastEnd = 0;
  let match;
  while ((match = regex.exec(lineText)) !== null) {
    cleanText += lineText.slice(lastEnd, match.index);
    chords.push({ ch: match[1], pos: cleanText.length });
    lastEnd = match.index + match[0].length;
  }
  cleanText += lineText.slice(lastEnd);
  return { text: cleanText, chords: chords.length > 0 ? chords : undefined };
}

function guessType(label) {
  const lower = label.toLowerCase();
  if (lower.includes('verso') || lower.includes('verse')) return 'verse';
  if (lower.includes('coro') || lower.includes('chorus')) return 'chorus';
  if (lower.includes('puente') || lower.includes('bridge')) return 'bridge';
  if (lower.includes('pre')) return 'prechorus';
  if (lower.includes('intro')) return 'intro';
  if (lower.includes('outro')) return 'outro';
  return 'verse';
}

/* ─── Unique ID generator ─── */
let _idCounter = 0;
function uid() { return `uid-${Date.now()}-${_idCounter++}`; }

/* ─── Main Render ─── */

/**
 * Render the block-based song editor
 * @param {HTMLElement} container
 * @param {string} [editId]
 */
export async function renderSongEditor(container, editId) {
  let existingSong = null;

  if (editId) {
    container.innerHTML = `
      <div class="editor fade-in" style="display: flex; justify-content: center; align-items: center; min-height: 50vh;">
        <p style="color: var(--color-text-secondary); font-size: 1.1rem;">⏳ Cargando canción...</p>
      </div>
    `;
    existingSong = await fetchSongDetail(editId);
    if (!existingSong) {
      container.innerHTML = `
        <div class="editor fade-in" style="display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 50vh; gap: 1rem;">
          <p style="color: var(--color-text-secondary); font-size: 1.1rem;">❌ No se encontró la canción.</p>
          <button class="btn btn--secondary" id="editor-back-home">← Volver</button>
        </div>
      `;
      container.querySelector('#editor-back-home')?.addEventListener('click', () => navigate('/admin/edit'));
      return;
    }
  }

  // Editable state
  let blocks = existingSong ? sectionsToBlocks(existingSong.sections) : [];

  // Build the editor HTML
  container.innerHTML = `
    <div class="editor fade-in">
      <h1 class="editor__title">${existingSong ? 'Editar canción' : 'Nueva canción'}</h1>

      <!-- Basic Info -->
      <div class="editor__section">
        <h2 class="editor__section-title">Información básica</h2>
        <div class="form-group">
          <label class="form-group__label" for="song-title">Título *</label>
          <input class="form-group__input" id="song-title" type="text" placeholder="Nombre de la canción" value="${escapeHtml(existingSong?.title || '')}" required />
        </div>
        <div class="form-group">
          <label class="form-group__label" for="song-artist">Artista</label>
          <input class="form-group__input" id="song-artist" type="text" placeholder="Hakuna Group Music" value="${escapeHtml(existingSong?.artist || 'Hakuna Group Music')}" />
        </div>
        <div class="editor__row-3">
          <div class="form-group">
            <label class="form-group__label" for="song-album">Álbum</label>
            <input class="form-group__input" id="song-album" type="text" placeholder="Nombre del álbum" value="${escapeHtml(existingSong?.album || '')}" />
          </div>
          <div class="form-group">
            <label class="form-group__label" for="song-order">Orden</label>
            <input class="form-group__input" id="song-order" type="number" placeholder="Ej: 1" value="${existingSong?.albumOrder || ''}" />
          </div>
          <div class="form-group">
            <label class="form-group__label" for="song-year">Año</label>
            <input class="form-group__input" id="song-year" type="number" placeholder="2024" value="${existingSong?.year || ''}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-group__label" for="song-genre">Género</label>
          <input class="form-group__input" id="song-genre" type="text" placeholder="Pop/Worship" value="${escapeHtml(existingSong?.genre || '')}" />
        </div>
      </div>

      <!-- Voice -->
      <div class="editor__section">
        <h2 class="editor__section-title">Tipo de voz</h2>
        <div class="form-group">
          <label class="form-group__label">Porcentaje: <span id="voice-value">♂ ${existingSong?.voicePercent?.male ?? 50}% / ♀ ${100 - (existingSong?.voicePercent?.male ?? 50)}%</span></label>
          <div class="voice-slider">
            <span style="font-size: 0.8rem;">♂</span>
            <input type="range" id="voice-range" min="0" max="100" value="${existingSong?.voicePercent?.male ?? 50}" />
            <span style="font-size: 0.8rem;">♀</span>
          </div>
        </div>
      </div>

      <!-- Cover Image -->
      <div class="editor__section">
        <h2 class="editor__section-title">Portada del álbum</h2>
        <div class="image-upload" id="image-upload-area">
          <div id="image-preview"></div>
          <p class="image-upload__text">📷 Haz clic o arrastra una imagen aquí</p>
          <input type="file" id="cover-input" accept="image/*" style="display: none;" />
        </div>
      </div>

      <!-- Block Editor -->
      <div class="editor__section">
        <h2 class="editor__section-title">Letras</h2>
        <div class="block-editor" id="block-editor"></div>
        <div class="block-editor__controls">
          <button class="btn btn--secondary block-editor__add-section" id="add-section-btn">+ Agregar sección</button>
          <button class="btn btn--secondary block-editor__import-btn" id="import-btn">📥 Importar texto</button>
        </div>
      </div>

      <!-- Live Preview -->
      <div class="editor__section">
        <h2 class="editor__section-title">Vista previa</h2>
        <div class="editor__preview" id="block-preview">
          <div id="preview-content"></div>
        </div>
      </div>

      <!-- Actions -->
      <div class="editor__actions">
        <button class="btn btn--secondary" id="editor-cancel">Cancelar</button>
        ${existingSong ? `<button class="btn btn--secondary" id="editor-delete" style="color: var(--color-error); border-color: var(--color-error); margin-right: auto;">🗑️ Eliminar</button>` : ''}
        <button class="btn btn--primary" id="editor-save">💾 Guardar canción</button>
      </div>
    </div>
  `;

  // Logout button
  renderLogoutButton(container.querySelector('.editor'));

  // ─── Setup event listeners ───

  // Voice range slider
  const voiceRange = container.querySelector('#voice-range');
  const voiceValue = container.querySelector('#voice-value');
  voiceRange.addEventListener('input', () => {
    const male = voiceRange.value;
    voiceValue.textContent = `♂ ${male}% / ♀ ${100 - male}%`;
  });

  // Image upload
  const uploadArea = container.querySelector('#image-upload-area');
  const coverInput = container.querySelector('#cover-input');
  const imagePreview = container.querySelector('#image-preview');
  uploadArea.addEventListener('click', () => coverInput.click());
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--color-primary)'; });
  uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault(); uploadArea.style.borderColor = '';
    if (e.dataTransfer.files.length > 0) handleImageFile(e.dataTransfer.files[0], imagePreview);
  });
  coverInput.addEventListener('change', () => {
    if (coverInput.files.length > 0) handleImageFile(coverInput.files[0], imagePreview);
  });

  // ─── Block Editor Core ───
  const editorRoot = container.querySelector('#block-editor');

  function renderBlocks() {
    editorRoot.innerHTML = blocks.map((block, bi) => renderSectionBlock(block, bi, blocks.length)).join('');
    updatePreview();
  }

  function renderSectionBlock(block, index, total) {
    const typeOptions = SECTION_TYPES.map(s =>
      `<option value="${s.type}" ${s.type === block.type ? 'selected' : ''}>${s.label}</option>`
    ).join('');

    const linesHtml = block.lines.map((line, li) => renderLineRow(line, li, block.lines.length, block.id)).join('');

    return `
      <div class="section-block" data-section-id="${block.id}" data-section-index="${index}">
        <div class="section-block__header">
          <div class="section-block__header-left">
            <select class="section-block__type-select" data-action="change-type" data-section="${index}">
              ${typeOptions}
            </select>
            <input class="section-block__label-input" type="text" value="${escapeHtml(block.label)}" data-action="change-label" data-section="${index}" placeholder="Nombre de la sección" />
          </div>
          <div class="section-block__header-actions">
            ${index > 0 ? `<button class="section-block__btn" data-action="move-section-up" data-section="${index}" title="Mover arriba">↑</button>` : ''}
            ${index < total - 1 ? `<button class="section-block__btn" data-action="move-section-down" data-section="${index}" title="Mover abajo">↓</button>` : ''}
            <button class="section-block__btn section-block__btn--danger" data-action="delete-section" data-section="${index}" title="Eliminar sección">🗑</button>
          </div>
        </div>
        <div class="section-block__lines">
          ${linesHtml}
        </div>
        <button class="section-block__add-line" data-action="add-line" data-section="${index}">+ Agregar línea</button>
      </div>
    `;
  }

  function renderLineRow(line, lineIndex, totalLines, sectionId) {
    const voiceChips = line.voices.map(v =>
      `<span class="line-row__voice-chip" style="background: ${getVoiceBgColor(v)}; color: ${getVoiceColor(v)};">${getVoiceLabel(v)}</span>`
    ).join('');

    const chordRowHtml = line.showChords
      ? `<input class="line-row__chord-input" type="text" value="${escapeHtml(buildChordString(line.text, line.chords))}" data-action="edit-chords" data-line-id="${line.id}" placeholder="Ej: Am    F    C    G" />`
      : '';

    return `
      <div class="line-row" data-line-id="${line.id}">
        ${chordRowHtml}
        <div class="line-row__main">
          <input class="line-row__input" type="text" value="${escapeHtml(line.text)}" data-action="edit-text" data-line-id="${line.id}" placeholder="Escribe la línea aquí..." />
          <div class="line-row__actions">
            ${voiceChips}
            <button class="line-row__btn line-row__btn--voice" data-action="toggle-voice" data-line-id="${line.id}" title="Asignar voces">🎤</button>
            <button class="line-row__btn ${line.showChords ? 'line-row__btn--active' : ''}" data-action="toggle-chords" data-line-id="${line.id}" title="Acordes">🎸</button>
            <button class="line-row__btn line-row__btn--delete" data-action="delete-line" data-line-id="${line.id}" title="Eliminar">✕</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Build a chord string from text and chord positions for display in the chord input
   */
  function buildChordString(text, chords) {
    if (!chords || chords.length === 0) return '';
    const sorted = [...chords].sort((a, b) => a.pos - b.pos);
    let result = '';
    for (const { ch, pos } of sorted) {
      while (result.length < pos) result += ' ';
      result += ch;
    }
    return result;
  }

  /**
   * Parse chord input string back to chord array
   */
  function parseChordsFromInput(chordStr) {
    const chords = [];
    const regex = /([A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?[0-9]?(?:\/[A-G][#b]?)?)/g;
    let match;
    while ((match = regex.exec(chordStr)) !== null) {
      chords.push({ ch: match[1], pos: match.index });
    }
    return chords;
  }

  // Find line/section by IDs
  function findLine(lineId) {
    for (const block of blocks) {
      const line = block.lines.find(l => l.id === lineId);
      if (line) return { block, line };
    }
    return null;
  }

  // ─── Event delegation for block editor ───
  editorRoot.addEventListener('input', (e) => {
    const action = e.target.dataset.action;
    if (action === 'edit-text') {
      const found = findLine(e.target.dataset.lineId);
      if (found) { found.line.text = e.target.value; updatePreview(); }
    } else if (action === 'edit-chords') {
      const found = findLine(e.target.dataset.lineId);
      if (found) { found.line.chords = parseChordsFromInput(e.target.value); updatePreview(); }
    } else if (action === 'change-label') {
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) { blocks[si].label = e.target.value; updatePreview(); }
    }
  });

  editorRoot.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'change-type') {
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) { blocks[si].type = e.target.value; renderBlocks(); }
    }
  });

  editorRoot.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'add-line') {
      const si = parseInt(btn.dataset.section);
      blocks[si].lines.push({
        id: uid(),
        text: '',
        voices: [],
        voiceRanges: [],
        chords: [],
        color: null,
        showChords: false,
      });
      renderBlocks();
      // Focus the new line input
      const lastInput = editorRoot.querySelector(`[data-section-index="${si}"] .line-row:last-child .line-row__input`);
      lastInput?.focus();
    }

    else if (action === 'delete-line') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.block.lines = found.block.lines.filter(l => l.id !== btn.dataset.lineId);
        renderBlocks();
      }
    }

    else if (action === 'toggle-chords') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.line.showChords = !found.line.showChords;
        renderBlocks();
      }
    }

    else if (action === 'toggle-voice') {
      const lineId = btn.dataset.lineId;
      showVoicePopover(btn, lineId);
    }

    else if (action === 'move-section-up') {
      const si = parseInt(btn.dataset.section);
      if (si > 0) { [blocks[si - 1], blocks[si]] = [blocks[si], blocks[si - 1]]; renderBlocks(); }
    }

    else if (action === 'move-section-down') {
      const si = parseInt(btn.dataset.section);
      if (si < blocks.length - 1) { [blocks[si], blocks[si + 1]] = [blocks[si + 1], blocks[si]]; renderBlocks(); }
    }

    else if (action === 'delete-section') {
      const si = parseInt(btn.dataset.section);
      if (confirm(`¿Eliminar la sección "${blocks[si].label}"?`)) {
        blocks.splice(si, 1);
        renderBlocks();
      }
    }
  });

  // Add section button
  container.querySelector('#add-section-btn').addEventListener('click', () => {
    const verseCount = blocks.filter(b => b.type === 'verse').length;
    blocks.push({
      id: uid(),
      type: 'verse',
      label: `Verso ${verseCount + 1}`,
      voices: [],
      lines: [{
        id: uid(),
        text: '',
        voices: [],
        voiceRanges: [],
        chords: [],
        color: null,
        showChords: false,
      }],
    });
    renderBlocks();
    // Focus the new section's first input
    const lastSection = editorRoot.querySelector('.section-block:last-child .line-row__input');
    lastSection?.focus();
  });

  // ─── Voice Popover ───
  let activePopover = null;

  function showVoicePopover(anchorBtn, lineId) {
    closePopover();
    const found = findLine(lineId);
    if (!found) return;

    const popover = document.createElement('div');
    popover.className = 'voice-popover';
    popover.innerHTML = `
      <div class="voice-popover__title">Asignar voces</div>
      ${VOICE_GROUPS.map(group => `
        <div class="voice-popover__group">
          <div class="voice-popover__group-label">${group.label}</div>
          ${group.voices.map(v => {
            const isActive = found.line.voices.includes(v.id);
            return `
              <button class="voice-popover__chip ${isActive ? 'voice-popover__chip--active' : ''}"
                data-voice-id="${v.id}"
                style="${isActive ? `background: ${getVoiceBgColor(v.id)}; color: ${getVoiceColor(v.id)}; border-color: ${getVoiceColor(v.id)};` : ''}">
                <span class="voice-popover__dot" style="background: ${getVoiceColor(v.id)};"></span>
                ${v.label} <span class="voice-popover__sublabel">(${v.sublabel})</span>
              </button>
            `;
          }).join('')}
        </div>
      `).join('')}
      <button class="voice-popover__clear" data-voice-clear="true">Quitar todas</button>
    `;

    // Position: below the anchor button
    const rect = anchorBtn.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${Math.max(8, rect.left - 80)}px`;
    popover.style.zIndex = '500';

    document.body.appendChild(popover);
    activePopover = popover;

    // Voice toggle clicks
    popover.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-voice-id]');
      if (chip) {
        const vid = chip.dataset.voiceId;
        if (found.line.voices.includes(vid)) {
          found.line.voices = found.line.voices.filter(v => v !== vid);
        } else {
          found.line.voices.push(vid);
        }
        renderBlocks();
        // Reopen popover if still relevant
        const newAnchor = editorRoot.querySelector(`[data-line-id="${lineId}"][data-action="toggle-voice"]`);
        if (newAnchor) showVoicePopover(newAnchor, lineId);
        return;
      }

      const clearBtn = e.target.closest('[data-voice-clear]');
      if (clearBtn) {
        found.line.voices = [];
        found.line.voiceRanges = [];
        renderBlocks();
        closePopover();
      }
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 10);
  }

  function handleOutsideClick(e) {
    if (activePopover && !activePopover.contains(e.target) && !e.target.closest('[data-action="toggle-voice"]')) {
      closePopover();
    }
  }

  function closePopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
      document.removeEventListener('click', handleOutsideClick);
    }
  }

  // ─── Import Modal ───
  container.querySelector('#import-btn').addEventListener('click', () => {
    showImportModal();
  });

  function showImportModal() {
    const overlay = document.createElement('div');
    overlay.className = 'import-modal__overlay';
    overlay.innerHTML = `
      <div class="import-modal">
        <div class="import-modal__header">
          <h3 class="import-modal__title">📥 Importar texto</h3>
          <button class="import-modal__close" id="import-close">✕</button>
        </div>
        <p class="import-modal__hint">
          Pega las letras. Las secciones se detectan con <code>[Verso 1]</code>, <code>[Coro]</code>, etc.
          Las líneas vacías separan secciones automáticamente.
        </p>
        <textarea class="import-modal__textarea" id="import-textarea" placeholder="[Verso 1]\nPrimera línea de la canción\nSegunda línea\n\n[Coro]\nEstribillo aquí..."></textarea>
        <div class="import-modal__preview" id="import-preview">
          <p style="color: var(--color-text-secondary); font-size: 0.85rem;">La vista previa aparecerá aquí...</p>
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
        previewEl.innerHTML = '<p style="color: var(--color-text-secondary); font-size: 0.85rem;">La vista previa aparecerá aquí...</p>';
        return;
      }
      previewEl.innerHTML = parsed.map(block =>
        `<div style="margin-bottom: 0.75rem;">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--color-primary); margin-bottom: 0.25rem; text-transform: uppercase;">${escapeHtml(block.label)}</div>
          ${block.lines.map(l => `<div style="font-size: 0.85rem; padding: 1px 0;">${escapeHtml(l.text)}</div>`).join('')}
        </div>`
      ).join('');
    });

    overlay.querySelector('#import-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#import-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#import-confirm-btn').addEventListener('click', () => {
      const parsed = parseImportText(textarea.value);
      if (parsed.length > 0) {
        blocks.push(...parsed);
        renderBlocks();
      }
      overlay.remove();
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    textarea.focus();
  }

  // ─── Preview ───
  function updatePreview() {
    const previewEl = container.querySelector('#preview-content');
    const sections = blocksToSections(blocks);
    if (sections.length === 0 || sections.every(s => s.lines.length === 0)) {
      previewEl.innerHTML = '<p style="color: var(--color-text-secondary); font-size: 0.875rem;">Agrega secciones y letras para ver la vista previa.</p>';
      return;
    }

    previewEl.innerHTML = sections.map(section => {
      const linesHtml = section.lines.map(l => {
        const voices = l.voices || [];
        let lineColor = '';
        if (l.color) {
          lineColor = l.color;
        } else if (voices.length === 1) {
          lineColor = getVoiceColor(voices[0]);
        }

        const displayText = l.voiceRanges?.length > 0
          ? buildHighlightedHTML(l.text, l.voiceRanges, voices)
          : (l.text.trim() === '' ? '&nbsp;' : escapeHtml(l.text));

        const styleStr = lineColor && !l.voiceRanges?.length ? ` color: ${lineColor};` : '';

        const voiceLabel = voices.length > 0 ? `<span style="font-size: 0.65rem; opacity: 0.6;"> [${voices.map(v => getVoiceLabel(v)).join(', ')}]</span>` : '';

        // Chord display
        if (l.chords?.length > 0) {
          const chordLine = buildChordPositionStringPreview(l.text, l.chords);
          return `
            <div class="lyrics__chord-line">
              <pre class="lyrics__chords" style="${styleStr}">${escapeHtml(chordLine)}</pre>
              <p class="lyrics__line" style="font-size: 1rem; line-height: 1.6;${styleStr}">${displayText}${voiceLabel}</p>
            </div>`;
        }

        return `<p class="lyrics__line" style="font-size: 1rem; line-height: 1.6;${styleStr}">${displayText}${voiceLabel}</p>`;
      }).join('');

      return `
        <div class="lyrics__section lyrics__section--${section.type}" style="margin-bottom: 1.25rem;">
          <div class="lyrics__section-label">${escapeHtml(section.label)}</div>
          ${linesHtml}
        </div>
      `;
    }).join('');
  }

  function buildChordPositionStringPreview(text, chords) {
    if (!chords || chords.length === 0) return '';
    const sorted = [...chords].sort((a, b) => a.pos - b.pos);
    let result = '';
    for (const { ch, pos } of sorted) {
      while (result.length < pos) result += ' ';
      result += ch;
    }
    return result;
  }

  // ─── Initial render ───
  renderBlocks();

  // ─── Cancel ───
  container.querySelector('#editor-cancel').addEventListener('click', () => navigate('/admin'));

  // ─── Delete ───
  if (existingSong) {
    container.querySelector('#editor-delete')?.addEventListener('click', () => handleDelete(existingSong));
  }

  // ─── Save ───
  container.querySelector('#editor-save').addEventListener('click', () => handleSave(container, existingSong, blocks));
}

/* ─── Image handling ─── */

let compressedCoverBlob = null;

function handleImageFile(file, previewEl) {
  if (!file.type.startsWith('image/')) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const MAX = 800;
    let { width, height } = img;
    if (width > MAX || height > MAX) {
      const ratio = Math.min(MAX / width, MAX / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        compressedCoverBlob = blob;
        const previewUrl = URL.createObjectURL(blob);
        previewEl.innerHTML = `
          <img class="image-upload__preview" src="${previewUrl}" alt="Preview" />
          <p style="font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 0.5rem;">
            WebP · ${width}×${height} · ${(blob.size / 1024).toFixed(1)} KB
          </p>
        `;
      },
      'image/webp',
      0.8,
    );
  };
  img.src = url;
}

/* ─── Save ─── */

async function handleSave(container, existingSong, blocks) {
  const btn = container.querySelector('#editor-save');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const title = container.querySelector('#song-title').value.trim();
    if (!title) {
      container.querySelector('#song-title').focus();
      throw new Error('El título es requerido');
    }

    const artist = container.querySelector('#song-artist').value.trim() || 'Hakuna Group Music';
    const album = container.querySelector('#song-album').value.trim() || 'Sin álbum';
    const albumOrder = Number.parseInt(container.querySelector('#song-order').value) || 0;
    const year = Number.parseInt(container.querySelector('#song-year').value) || new Date().getFullYear();
    const genre = container.querySelector('#song-genre').value.trim() || '';
    const malePercent = Number.parseInt(container.querySelector('#voice-range').value);

    const songId = existingSong?.id || generateSlug(title, album);
    const albumSlug = generateSlug(album);
    let voiceType;
    if (malePercent >= 70) voiceType = 'male';
    else if (malePercent <= 30) voiceType = 'female';
    else voiceType = 'mixed';

    let coverImage = existingSong?.coverImage || `${albumSlug}.webp`;
    const token = getToken();

    // 1. Upload new image if present
    if (compressedCoverBlob) {
      const fd = new FormData();
      fd.append('cover', compressedCoverBlob, `${albumSlug}.webp`);
      const imgRes = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        coverImage = imgData.url;
      }
    }

    // 2. Save song data
    const newSong = {
      id: songId,
      title,
      artist,
      album,
      albumSlug,
      year,
      genre,
      voiceType,
      voicePercent: { male: malePercent, female: 100 - malePercent },
      coverImage,
      albumOrder,
      sections: blocksToSections(blocks),
    };

    const method = existingSong ? 'PUT' : 'POST';
    const url = existingSong ? `${API_URL}/songs/${existingSong.id}` : `${API_URL}/songs`;

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(newSong),
    });

    if (!res.ok) throw new Error('Error guardando la canción');

    await refreshData();
    navigate('/');
    showToast('✅ Canción guardada correctamente');
  } catch (err) {
    console.error(err);
    showToast('❌ Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar canción';
  }
}

/* ─── Delete ─── */

async function handleDelete(song) {
  if (!confirm(`¿Estás seguro de que deseas eliminar la canción "${song.title}"?`)) return;
  const token = getToken();
  try {
    const res = await fetch(`${API_URL}/songs/${song.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Error al eliminar');
    await refreshData();
    navigate('/admin/edit');
    showToast('🗑️ Canción eliminada');
  } catch (e) {
    console.error(e);
    showToast('❌ Error: ' + e.message);
  }
}

/* ─── Utilities ─── */

function generateSlug(...parts) {
  return parts
    .join('-')
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
