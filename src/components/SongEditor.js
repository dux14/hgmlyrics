/**
 * SongEditor.js — Block-based Song Editor
 *
 * Visual block editor (Notion/Worship Tools style) for creating and editing songs.
 * Features: section blocks, line rows, voice assignment (line + word-level),
 * chord editor (UltimateGuitar style), import modal, and live preview.
 */

import { fetchSongDetail, refreshData } from '../lib/store.js';
import { navigate } from '../router.js';
import { getSession } from '../lib/authStore.js';
import { renderSongView } from './SongView.js';
import {
  VALID_VOICE_IDS,
  VOICE_TYPES,
  buildHighlightedHTML,
  validateVoiceRanges,
} from '../lib/voiceSystem.js';
import { getDragRange, getCaretOffsetAtPoint } from '../lib/caretSelection.js';
import { openVoiceBottomSheet } from './VoiceBottomSheet.js';
import { MUSICAL_KEYS } from '../lib/musicKeys.js';

const API_URL = '/api';

const LINK_PLATFORMS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'apple_music', label: 'Apple Music' },
  { id: 'deezer', label: 'Deezer' },
  { id: 'amazon_music', label: 'Amazon Music' },
  { id: 'tidal', label: 'Tidal' },
  { id: 'soundcloud', label: 'SoundCloud' },
];

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
    lines: (section.lines || []).map((line, li) => ({
      id: `line-${si}-${li}-${Date.now()}`,
      text: line.text || '',
      voiceRanges: line.voiceRanges || [],
      chords: line.chords || [],
      annotation: line.annotation || false,
      showChords: line.chords && line.chords.length > 0,
    })),
  }));
}

/**
 * Convert editable blocks back to sections JSON for saving
 */
function blocksToSections(blocks) {
  return blocks.map((block) => {
    const section = {
      type: block.type,
      label: block.label,
      lines: block.lines
        .filter((l) => l.text.trim() !== '' || l.chords.length > 0 || l.annotation)
        .map((l) => {
          const line = { text: l.text };
          if (l.voiceRanges && l.voiceRanges.length > 0) line.voiceRanges = l.voiceRanges;
          if (l.chords && l.chords.length > 0) line.chords = l.chords;
          if (l.annotation) line.annotation = true;
          return line;
        }),
    };
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
          lines: [],
        };
      }

      // Parse voice tags
      let line = rawLine;
      let voices = [];
      const voiceMatch = line.match(/^\{@([a-z,]+)\}/);
      if (voiceMatch) {
        voices = voiceMatch[1].split(',').filter((v) => VALID_VOICE_IDS.includes(v));
        line = line.slice(voiceMatch[0].length);
      }

      // Parse inline chords
      const { text: cleanText, chords } = parseLineChords(line);

      current.lines.push({
        id: `line-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: cleanText,
        voiceRanges: voices.length > 0 ? [{ start: 0, end: cleanText.length, voices }] : [],
        chords: chords || [],
        showChords: chords && chords.length > 0,
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
function uid() {
  return `uid-${Date.now()}-${_idCounter++}`;
}

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
      container
        .querySelector('#editor-back-home')
        ?.addEventListener('click', () => navigate('/admin/edit'));
      return;
    }
  }

  // Editable state
  const blocks = existingSong ? sectionsToBlocks(existingSong.sections) : [];

  // Per-line UI mode: 'text' (default <input>) or 'voices' (display + drag-select)
  const lineModes = new Map(); // lineId -> 'text' | 'voices'
  function getLineMode(id) {
    return lineModes.get(id) || 'text';
  }
  function setLineMode(id, mode) {
    lineModes.set(id, mode);
    renderBlocks();
  }

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
        <div class="editor__row-3">
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label" for="song-genre">Género</label>
            <input class="form-group__input" id="song-genre" type="text" placeholder="Pop/Worship" value="${escapeHtml(existingSong?.genre || '')}" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-group__label" for="song-cejilla">Cejilla</label>
            <input class="form-group__input" id="song-cejilla" type="number" min="0" max="12" placeholder="0" value="${existingSong?.cejilla || ''}" />
          </div>
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label" for="song-key">Tonalidad</label>
            <select class="form-group__input" id="song-key">
              <option value="">(sin asignar)</option>
              ${MUSICAL_KEYS.map(
                (k) =>
                  `<option value="${k}" ${existingSong?.key === k ? 'selected' : ''}>${k}</option>`,
              ).join('')}
            </select>
          </div>
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

      <!-- Links -->
      <div class="editor__section">
        <h2 class="editor__section-title">Links de plataformas</h2>
        <div id="editor-platform-links">
          ${LINK_PLATFORMS.map(
            (p) => `
            <div class="form-group">
              <label class="form-group__label" for="link-${p.id}">${p.label}</label>
              <input class="form-group__input" id="link-${p.id}" type="url" placeholder="https://..." data-platform="${p.id}" />
            </div>
          `,
          ).join('')}
        </div>
        <h2 class="editor__section-title" style="margin-top: var(--space-lg);">Links de voces (Drive)</h2>
        <div id="editor-voice-links"></div>
        <button class="btn btn--secondary" id="add-voice-link-btn" type="button" style="margin-top: var(--space-sm);">+ Agregar link de voz</button>
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
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'var(--color-primary)';
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '';
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '';
    if (e.dataTransfer.files.length > 0) handleImageFile(e.dataTransfer.files[0], imagePreview);
  });
  coverInput.addEventListener('change', () => {
    if (coverInput.files.length > 0) handleImageFile(coverInput.files[0], imagePreview);
  });

  // ─── Links Editor ───
  const voiceLinksEl = container.querySelector('#editor-voice-links');
  let voiceLinkItems = [];

  function renderVoiceLinks() {
    voiceLinksEl.innerHTML = voiceLinkItems
      .map(
        (item, i) => `
        <div class="editor__row-3" style="align-items: flex-end; margin-bottom: var(--space-sm);" data-vlink="${i}">
          <div class="form-group" style="flex: 1;">
            <label class="form-group__label">Voz</label>
            <select class="form-group__input" data-action="vlink-voice" data-idx="${i}">
              ${VOICE_TYPES.map((v) => `<option value="${v.id}" ${item.voiceType === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label">URL (Drive)</label>
            <input class="form-group__input" type="url" placeholder="https://drive.google.com/..." data-action="vlink-url" data-idx="${i}" value="${escapeHtml(item.url || '')}" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-group__label">Etiqueta</label>
            <input class="form-group__input" type="text" placeholder="Partitura" data-action="vlink-label" data-idx="${i}" value="${escapeHtml(item.label || '')}" />
          </div>
          <button class="btn btn--secondary" style="color: var(--color-error); border-color: var(--color-error); padding: 0.5rem;" data-action="vlink-delete" data-idx="${i}" type="button">✕</button>
        </div>
      `,
      )
      .join('');
  }

  voiceLinksEl.addEventListener('input', (e) => {
    const idx = parseInt(e.target.dataset.idx);
    if (Number.isNaN(idx)) return;
    if (e.target.dataset.action === 'vlink-url') voiceLinkItems[idx].url = e.target.value;
    if (e.target.dataset.action === 'vlink-label') voiceLinkItems[idx].label = e.target.value;
  });

  voiceLinksEl.addEventListener('change', (e) => {
    const idx = parseInt(e.target.dataset.idx);
    if (Number.isNaN(idx)) return;
    if (e.target.dataset.action === 'vlink-voice') voiceLinkItems[idx].voiceType = e.target.value;
  });

  voiceLinksEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="vlink-delete"]');
    if (!btn) return;
    voiceLinkItems.splice(parseInt(btn.dataset.idx), 1);
    renderVoiceLinks();
  });

  container.querySelector('#add-voice-link-btn').addEventListener('click', () => {
    voiceLinkItems.push({ voiceType: 'soprano', url: '', label: '' });
    renderVoiceLinks();
  });

  if (editId) {
    fetch(`${API_URL}/songs/${editId}/links`)
      .then((r) => (r.ok ? r.json() : { platforms: [], voices: [] }))
      .then(({ platforms, voices }) => {
        for (const p of platforms) {
          const input = container.querySelector(`#link-${p.platform}`);
          if (input) input.value = p.url;
        }
        voiceLinkItems = voices.map((v) => ({
          voiceType: v.voiceType,
          url: v.url,
          label: v.label || '',
        }));
        renderVoiceLinks();
      })
      .catch(() => {});
  }

  renderVoiceLinks();

  // ─── Block Editor Core ───
  const editorRoot = container.querySelector('#block-editor');

  function renderBlocks() {
    editorRoot.innerHTML = blocks
      .map((block, bi) => renderSectionBlock(block, bi, blocks.length))
      .join('');
    updatePreview();
  }

  function renderSectionBlock(block, index, total) {
    const typeOptions = SECTION_TYPES.map(
      (s) =>
        `<option value="${s.type}" ${s.type === block.type ? 'selected' : ''}>${s.label}</option>`,
    ).join('');

    const linesHtml = block.lines
      .map((line, li) => renderLineRow(line, li, block.lines.length, block.id))
      .join('');

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

  function renderLineRow(line, _lineIndex, _totalLines, _sectionId) {
    const mode = getLineMode(line.id);
    const rangeCount = (line.voiceRanges || []).length;

    const chordRowHtml = line.showChords
      ? `<input class="line-row__chord-input" type="text" value="${escapeHtml(buildChordString(line.text, line.chords))}" data-action="edit-chords" data-line-id="${line.id}" placeholder="Ej: Am    F    C    G" />`
      : '';

    const mainContent =
      mode === 'voices'
        ? `<div class="line-row__voice-display" data-action="voice-display" data-line-id="${line.id}">${buildHighlightedHTML(line.text || ' ', line.voiceRanges || [], 'all')}</div>`
        : `<input class="line-row__input" type="text" value="${escapeHtml(line.text)}" data-action="edit-text" data-line-id="${line.id}" placeholder="Escribe la línea aquí..." />`;

    const voiceModeActive = mode === 'voices' ? 'line-row__btn--active' : '';
    const rangeCountHtml =
      rangeCount > 0
        ? `<span class="line-row__range-count" title="${rangeCount} rango(s) asignado(s)">${rangeCount}</span>`
        : '';

    return `
      <div class="line-row" data-line-id="${line.id}">
        ${chordRowHtml}
        <div class="line-row__main">
          ${mainContent}
          <div class="line-row__actions">
            ${rangeCountHtml}
            <button class="line-row__btn line-row__btn--voice-mode ${voiceModeActive}" data-action="toggle-voice-mode" data-line-id="${line.id}" title="${mode === 'voices' ? 'Volver a editar texto' : 'Asignar voces'}">🎨</button>
            <button class="line-row__btn ${line.showChords ? 'line-row__btn--active' : ''}" data-action="toggle-chords" data-line-id="${line.id}" title="Acordes">🎸</button>
            <button class="line-row__btn ${line.annotation ? 'line-row__btn--active line-row__btn--annotation' : ''}" data-action="toggle-annotation" data-line-id="${line.id}" title="Marcar como anotación/guía">🏷️</button>
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
      const line = block.lines.find((l) => l.id === lineId);
      if (line) return { block, line };
    }
    return null;
  }

  // ─── Event delegation for block editor ───
  editorRoot.addEventListener('input', (e) => {
    const action = e.target.dataset.action;
    if (action === 'edit-text') {
      const found = findLine(e.target.dataset.lineId);
      if (found) {
        found.line.text = e.target.value;
        updatePreview();
      }
    } else if (action === 'edit-chords') {
      const found = findLine(e.target.dataset.lineId);
      if (found) {
        found.line.chords = parseChordsFromInput(e.target.value);
        updatePreview();
      }
    } else if (action === 'change-label') {
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) {
        blocks[si].label = e.target.value;
        updatePreview();
      }
    }
  });

  editorRoot.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'change-type') {
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) {
        blocks[si].type = e.target.value;
        renderBlocks();
      }
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
        voiceRanges: [],
        chords: [],
        showChords: false,
      });
      renderBlocks();
      // Focus the new line input
      const lastInput = editorRoot.querySelector(
        `[data-section-index="${si}"] .line-row:last-child .line-row__input`,
      );
      lastInput?.focus();
    } else if (action === 'delete-line') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.block.lines = found.block.lines.filter((l) => l.id !== btn.dataset.lineId);
        renderBlocks();
      }
    } else if (action === 'toggle-chords') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.line.showChords = !found.line.showChords;
        renderBlocks();
      }
    } else if (action === 'toggle-annotation') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.line.annotation = !found.line.annotation;
        renderBlocks();
      }
    } else if (action === 'toggle-voice-mode') {
      const lineId = e.target.dataset.lineId;
      const found = findLine(lineId);
      if (!found) return;
      const current = getLineMode(lineId);
      if (current === 'voices') {
        // Leaving voice mode → no validation needed; ranges unchanged
        setLineMode(lineId, 'text');
      } else {
        // Entering voice mode from text mode → validate ranges against current text length
        found.line.voiceRanges = validateVoiceRanges(
          found.line.voiceRanges || [],
          (found.line.text || '').length,
        );
        setLineMode(lineId, 'voices');
      }
      return;
    } else if (action === 'move-section-up') {
      const si = parseInt(btn.dataset.section);
      if (si > 0) {
        [blocks[si - 1], blocks[si]] = [blocks[si], blocks[si - 1]];
        renderBlocks();
      }
    } else if (action === 'move-section-down') {
      const si = parseInt(btn.dataset.section);
      if (si < blocks.length - 1) {
        [blocks[si], blocks[si + 1]] = [blocks[si + 1], blocks[si]];
        renderBlocks();
      }
    } else if (action === 'delete-section') {
      const si = parseInt(btn.dataset.section);
      if (confirm(`¿Eliminar la sección "${blocks[si].label}"?`)) {
        blocks.splice(si, 1);
        renderBlocks();
      }
    }
  });

  // ─── Drag-select on voice display ───
  let dragState = null; // { lineId, display, startPt }

  editorRoot.addEventListener('pointerdown', (e) => {
    const display = e.target.closest('[data-action="voice-display"]');
    if (!display) return;
    e.preventDefault();
    display.setPointerCapture?.(e.pointerId);
    dragState = {
      lineId: display.dataset.lineId,
      display,
      startPt: { x: e.clientX, y: e.clientY },
    };
  });

  editorRoot.addEventListener('pointerup', (e) => {
    if (!dragState) return;
    const { lineId, display, startPt } = dragState;
    dragState = null;
    const found = findLine(lineId);
    if (!found) return;

    const endPt = { x: e.clientX, y: e.clientY };
    const dist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);

    if (dist < 4) {
      // Tap — open sheet for the tapped range if any, else do nothing
      const offset = getCaretOffsetAtPoint(display, endPt.x, endPt.y);
      if (offset === null) return;
      const range = (found.line.voiceRanges || []).find((r) => offset >= r.start && offset < r.end);
      if (range) {
        openSheetForRange(found, range, range.start, range.end);
      }
      return;
    }

    // Drag — resolve [start, end] in character offsets
    const dragRange = getDragRange(display, startPt, endPt);
    if (!dragRange) return;
    const [start, end] = dragRange;
    if (start >= end) return;
    openSheetForRange(found, null, start, end);
  });

  function openSheetForRange(found, existingRange, start, end) {
    const text = found.line.text || '';
    const selectedText = text.slice(start, end);
    const initialVoices = existingRange ? [...existingRange.voices] : [];

    openVoiceBottomSheet({
      selectedText,
      initialVoices,
      onApply: (voices) => {
        applyRangeMutation(found.line, start, end, voices);
        renderBlocks();
        updatePreview();
      },
      onRemove: () => {
        applyRangeMutation(found.line, start, end, []);
        renderBlocks();
        updatePreview();
      },
    });
  }

  /**
   * Apply the REPLACE rule:
   * - Trim/drop existing ranges that overlap [start, end)
   * - If `voices` non-empty, insert the new range
   * - Re-validate
   */
  function applyRangeMutation(line, start, end, voices) {
    const next = [];
    for (const r of line.voiceRanges || []) {
      if (r.end <= start || r.start >= end) {
        next.push(r); // no overlap
      } else {
        // overlap — trim/split
        if (r.start < start) next.push({ start: r.start, end: start, voices: r.voices });
        if (r.end > end) next.push({ start: end, end: r.end, voices: r.voices });
      }
    }
    if (voices.length > 0) {
      next.push({ start, end, voices });
    }
    line.voiceRanges = validateVoiceRanges(next, (line.text || '').length);
  }

  // Add section button
  container.querySelector('#add-section-btn').addEventListener('click', () => {
    const verseCount = blocks.filter((b) => b.type === 'verse').length;
    blocks.push({
      id: uid(),
      type: 'verse',
      label: `Verso ${verseCount + 1}`,
      lines: [
        {
          id: uid(),
          text: '',
          voiceRanges: [],
          chords: [],
          showChords: false,
        },
      ],
    });
    renderBlocks();
    // Focus the new section's first input
    const lastSection = editorRoot.querySelector('.section-block:last-child .line-row__input');
    lastSection?.focus();
  });

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
        previewEl.innerHTML =
          '<p style="color: var(--color-text-secondary); font-size: 0.85rem;">La vista previa aparecerá aquí...</p>';
        return;
      }
      previewEl.innerHTML = parsed
        .map(
          (block) =>
            `<div style="margin-bottom: 0.75rem;">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--color-primary); margin-bottom: 0.25rem; text-transform: uppercase;">${escapeHtml(block.label)}</div>
          ${block.lines.map((l) => `<div style="font-size: 0.85rem; padding: 1px 0;">${escapeHtml(l.text)}</div>`).join('')}
        </div>`,
        )
        .join('');
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
    if (sections.length === 0 || sections.every((s) => s.lines.length === 0)) {
      previewEl.innerHTML =
        '<p style="color: var(--color-text-secondary); font-size: 0.875rem;">Agrega secciones y letras para ver la vista previa.</p>';
      return;
    }

    // Build a draft song object for renderSongView
    const title = container.querySelector('#song-title')?.value?.trim() || 'Sin título';
    const artist = container.querySelector('#song-artist')?.value?.trim() || 'Hakuna Group Music';
    const album = container.querySelector('#song-album')?.value?.trim() || '';
    const year = container.querySelector('#song-year')?.value || '';
    const genre = container.querySelector('#song-genre')?.value?.trim() || '';
    const malePercent = Number.parseInt(container.querySelector('#voice-range')?.value) || 50;
    let voiceType;
    if (malePercent >= 70) voiceType = 'male';
    else if (malePercent <= 30) voiceType = 'female';
    else voiceType = 'mixed';

    const draftSong = {
      isPreview: true,
      title,
      artist,
      album,
      year,
      genre,
      voiceType,
      voicePercent: { male: malePercent, female: 100 - malePercent },
      coverImage: '',
      sections,
    };

    renderSongView(previewEl, draftSong);
  }

  // ─── Initial render ───
  renderBlocks();

  // ─── Cancel ───
  container.querySelector('#editor-cancel').addEventListener('click', () => navigate('/admin'));

  // ─── Delete ───
  if (existingSong) {
    container
      .querySelector('#editor-delete')
      ?.addEventListener('click', () => handleDelete(existingSong));
  }

  // ─── Save ───
  container
    .querySelector('#editor-save')
    .addEventListener('click', () => handleSave(container, existingSong, blocks, voiceLinkItems));
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

function collectLinks(container, voiceLinkItems) {
  const platforms = [];
  for (const p of LINK_PLATFORMS) {
    const input = container.querySelector(`#link-${p.id}`);
    if (input?.value?.trim()) {
      platforms.push({ platform: p.id, url: input.value.trim() });
    }
  }
  const voices = voiceLinkItems
    .filter((v) => v.url?.trim())
    .map((v) => ({ voiceType: v.voiceType, url: v.url.trim(), label: v.label?.trim() || null }));
  return { platforms, voices };
}

async function handleSave(container, existingSong, blocks, voiceLinkItems) {
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
    const year =
      Number.parseInt(container.querySelector('#song-year').value) || new Date().getFullYear();
    const genre = container.querySelector('#song-genre').value.trim() || '';
    const malePercent = Number.parseInt(container.querySelector('#voice-range').value);

    const songId = existingSong?.id || crypto.randomUUID();
    const albumSlug = generateSlug(album);
    let voiceType;
    if (malePercent >= 70) voiceType = 'male';
    else if (malePercent <= 30) voiceType = 'female';
    else voiceType = 'mixed';

    let coverImage = existingSong?.coverImage || `${albumSlug}.webp`;
    const token = getSession()?.access_token;

    // 1. Upload new image if present
    if (compressedCoverBlob) {
      const fd = new FormData();
      fd.append('cover', compressedCoverBlob, `${albumSlug}.webp`);
      const imgRes = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        coverImage = imgData.url;
      }
    }

    // 2. Save song data
    const cejilla = Number.parseInt(container.querySelector('#song-cejilla').value) || null;
    const key = container.querySelector('#song-key').value || null;

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
      cejilla,
      key,
      sections: blocksToSections(blocks),
    };

    const method = existingSong ? 'PUT' : 'POST';
    const url = existingSong ? `${API_URL}/songs/${existingSong.id}` : `${API_URL}/songs`;

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newSong),
    });

    if (!res.ok) throw new Error('Error guardando la canción');

    const links = collectLinks(container, voiceLinkItems);
    if (links.platforms.length > 0 || links.voices.length > 0) {
      await fetch(`${API_URL}/songs/${songId}/links`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(links),
      });
    }

    await refreshData();
    navigate(existingSong ? '/admin/edit' : '/admin');
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
  const token = getSession()?.access_token;
  try {
    const res = await fetch(`${API_URL}/songs/${song.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
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
