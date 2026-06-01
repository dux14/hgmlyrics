/**
 * SongEditor.js — Block-based Song Editor
 *
 * Visual block editor (Notion/Worship Tools style) for creating and editing songs.
 * Features: section blocks, line rows, voice assignment (line + word-level),
 * chord editor (UltimateGuitar style), import modal, and live preview.
 */

import { fetchSongDetail, refreshData } from '../lib/store.js';
import { navigate } from '../router.js';
import { getSession, isFeatureEnabled } from '../lib/authStore.js';
import { renderSongView } from './SongView.js';
import {
  CANONICAL_VOICE_ORDER,
  VALID_VOICE_IDS,
  VOICE_TYPES,
  validateSongV2,
  getVoiceLabel,
  isValidNote,
  deriveVoiceRanges,
} from '../lib/voiceSystem.js';
import {
  boundariesToSyllables,
  toggleBoundary,
  syllablesToBoundaries,
  autoSuggestBoundaries,
  tokenizeLineForChords,
} from '../lib/syllabify.js';
import { MUSICAL_KEYS } from '../lib/musicKeys.js';
import { icon } from '../lib/icons.js';

/**
 * Notas válidas seleccionables por sílaba (notación científica, octavas 2-6
 * cubren el rango coral típico). El usuario puede dejar una sílaba sin nota.
 */
const NOTE_OPTIONS = (() => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const out = [];
  for (let oct = 2; oct <= 6; oct++) {
    for (const n of names) out.push(`${n}${oct}`);
  }
  return out.filter(isValidNote);
})();

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
    speedPreset: typeof section.speedPreset === 'number' ? section.speedPreset : null,
    lines: (section.lines || []).map((line, li) => ({
      id: `line-${si}-${li}-${Date.now()}`,
      text: line.text || '',
      voiceRanges: line.voiceRanges || [],
      chords: line.chords || [],
      annotation: line.annotation || false,
      showChords: line.chords && line.chords.length > 0,
      // v2 (sólo se serializa si la canción es v2 — ver blocksToSectionsV2):
      syllables: Array.isArray(line.syllables) ? line.syllables : null,
      voiceLines: line.voiceLines && typeof line.voiceLines === 'object' ? line.voiceLines : null,
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
 * v2: como blocksToSections pero conservando syllables/voiceLines por línea y
 * speedPreset por sección. Sólo se usa cuando la canción tiene voiceRoster.
 * @param {Array} blocks
 * @returns {Array}
 */
function blocksToSectionsV2(blocks, roster = []) {
  return blocks.map((block) => {
    const section = {
      type: block.type,
      label: block.label,
      lines: block.lines
        .filter((l) => l.text.trim() !== '' || l.chords.length > 0 || l.annotation)
        .map((l) => {
          const line = { text: l.text };
          if (l.chords && l.chords.length > 0) line.chords = l.chords;
          if (l.annotation) line.annotation = true;
          if (Array.isArray(l.syllables) && l.syllables.length > 0) line.syllables = l.syllables;
          if (l.voiceLines && Object.keys(l.voiceLines).length > 0) line.voiceLines = l.voiceLines;
          // voiceRanges (coloreado de Letra) se DERIVA de voiceLines cuando existe;
          // si no hay voiceLines, se conservan los voiceRanges previos.
          const derived = deriveVoiceRanges(line, roster);
          if (derived && derived.length > 0) line.voiceRanges = derived;
          else if (l.voiceRanges && l.voiceRanges.length > 0) line.voiceRanges = l.voiceRanges;
          return line;
        }),
    };
    if (typeof block.speedPreset === 'number' && !Number.isNaN(block.speedPreset)) {
      section.speedPreset = block.speedPreset;
    }
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
 * @param {{from?: string|null}} [opts] - Si viene `from`, al guardar/cancelar se vuelve a /song/<from>.
 */
export async function renderSongEditor(container, editId, { from = null } = {}) {
  let existingSong = null;

  if (editId) {
    container.innerHTML = `
      <div class="editor fade-in" style="display: flex; justify-content: center; align-items: center; min-height: 50vh;">
        <p style="color: var(--color-text-secondary); font-size: 1.1rem;">${icon('music', { size: 18, className: 'loading-pulse' })} Cargando canción...</p>
      </div>
    `;
    existingSong = await fetchSongDetail(editId);
    if (!existingSong) {
      container.innerHTML = `
        <div class="editor fade-in" style="display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 50vh; gap: 1rem;">
          <p style="color: var(--color-text-secondary); font-size: 1.1rem; display: inline-flex; align-items: center; gap: 0.4em;">${icon('frown', { size: 18 })} No se encontró la canción.</p>
          <button class="btn btn--secondary" id="editor-back-home">← Volver</button>
        </div>
      `;
      container
        .querySelector('#editor-back-home')
        ?.addEventListener('click', () => navigate(from ? '/song/' + from : '/admin/edit'));
      return;
    }
  }

  // Editable state
  const blocks = existingSong ? sectionsToBlocks(existingSong.sections) : [];

  // ─── v2 (Tono) gating ───
  // When false, EVERYTHING below related to voz_tono is skipped so the v1
  // render output, event wiring and save payload stay byte-for-byte identical.
  const v2Enabled = isFeatureEnabled('voz_tono');
  const voiceRoster = v2Enabled
    ? Array.isArray(existingSong?.voiceRoster)
      ? existingSong.voiceRoster.map((v) => ({ ...v }))
      : []
    : [];

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
          <p class="image-upload__text" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('camera', { size: 18 })} Haz clic o arrastra una imagen aquí</p>
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

      ${
        v2Enabled
          ? `<!-- Roster de voces (v2) -->
      <section class="editor-roster editor__section" id="editor-roster">
        <h2 class="editor__section-title" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('users', { size: 18 })} Voces de la canción</h2>
        <div id="roster-list"></div>
        <button class="btn btn--secondary" id="add-roster-voice" type="button" style="margin-top: var(--space-sm); display: inline-flex; align-items: center; gap: 0.4em;">${icon('plus', { size: 16 })} Añadir voz</button>
      </section>`
          : ''
      }

      <!-- Block Editor -->
      <div class="editor__section">
        <h2 class="editor__section-title">Letras</h2>
        <div class="block-editor" id="block-editor"></div>
        <div class="block-editor__controls">
          <button class="btn btn--secondary block-editor__add-section" id="add-section-btn">+ Agregar sección</button>
          <button class="btn btn--secondary block-editor__import-btn" id="import-btn" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('download', { size: 16 })} Importar texto</button>
        </div>
      </div>

      <!-- Live Preview -->
      <div class="editor__section">
        <h2 class="editor__section-title">Vista previa</h2>
        <div class="editor__preview" id="block-preview">
          <div id="preview-content"></div>
        </div>
      </div>

      <!-- Save error (inline, gated visibility) -->
      <div class="editor__save-error" id="editor-save-error" role="alert" hidden></div>

      <!-- Actions -->
      <div class="editor__actions">
        <button class="btn btn--secondary" id="editor-cancel">Cancelar</button>
        ${existingSong ? `<button class="btn btn--secondary" id="editor-delete" style="color: var(--color-error); border-color: var(--color-error); margin-right: auto; display: inline-flex; align-items: center; gap: 0.4em;">${icon('trash', { size: 16 })} Eliminar</button>` : ''}
        <button class="btn btn--primary" id="editor-save" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('save', { size: 16 })} Guardar canción</button>
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
          <button class="btn btn--secondary" style="color: var(--color-error); border-color: var(--color-error); padding: 0.5rem;" data-action="vlink-delete" data-idx="${i}" type="button" aria-label="Eliminar enlace">${icon('close', { size: 16 })}</button>
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

  // ─── Roster de voces (v2, gated) ───
  const rosterListEl = v2Enabled ? container.querySelector('#roster-list') : null;

  function renderRoster() {
    if (!rosterListEl) return;
    if (voiceRoster.length === 0) {
      rosterListEl.innerHTML =
        '<p style="color: var(--color-text-secondary); font-size: 0.875rem;">Aún no hay voces. Añade al menos una para autorar tono por sílaba.</p>';
      return;
    }
    rosterListEl.innerHTML = voiceRoster
      .map((v, i) => {
        const keyInvalid =
          v.referenceKey !== null &&
          v.referenceKey !== undefined &&
          v.referenceKey !== '' &&
          !isValidNote(v.referenceKey);
        return `
        <div class="roster-row" data-roster-idx="${i}">
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label">Nombre</label>
            <input class="form-group__input" type="text" data-action="roster-name" data-idx="${i}" value="${escapeHtml(v.name || '')}" placeholder="Voz ${i + 1}" />
          </div>
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label">Categoría</label>
            <select class="form-group__input" data-action="roster-category" data-idx="${i}">
              ${CANONICAL_VOICE_ORDER.map((c) => `<option value="${c}" ${v.category === c ? 'selected' : ''}>${getVoiceLabel(c)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-group__label">Tono ref.</label>
            <input class="form-group__input ${keyInvalid ? 'form-group__input--invalid' : ''}" type="text" data-action="roster-refkey" data-idx="${i}" value="${escapeHtml(v.referenceKey || '')}" placeholder="Ej: B3" aria-invalid="${keyInvalid}" />
          </div>
          <button class="btn btn--secondary roster-row__delete" data-action="roster-delete" data-idx="${i}" type="button" aria-label="Eliminar voz">${icon('trash', { size: 16 })}</button>
        </div>`;
      })
      .join('');
  }

  /**
   * Remove all references to a roster id from every line's voiceLines.
   * @param {string} rosterId
   */
  function purgeRosterIdFromLines(rosterId) {
    for (const block of blocks) {
      for (const line of block.lines) {
        if (line.voiceLines && line.voiceLines[rosterId]) {
          delete line.voiceLines[rosterId];
        }
      }
    }
  }

  if (v2Enabled) {
    rosterListEl.addEventListener('input', (e) => {
      const idx = Number.parseInt(e.target.dataset.idx, 10);
      if (Number.isNaN(idx) || !voiceRoster[idx]) return;
      const action = e.target.dataset.action;
      if (action === 'roster-name') {
        voiceRoster[idx].name = e.target.value;
      } else if (action === 'roster-refkey') {
        const val = e.target.value.trim();
        voiceRoster[idx].referenceKey = val === '' ? null : val;
        const invalid = val !== '' && !isValidNote(val);
        e.target.classList.toggle('form-group__input--invalid', invalid);
        e.target.setAttribute('aria-invalid', String(invalid));
      }
    });

    rosterListEl.addEventListener('change', (e) => {
      const idx = Number.parseInt(e.target.dataset.idx, 10);
      if (Number.isNaN(idx) || !voiceRoster[idx]) return;
      if (e.target.dataset.action === 'roster-category') {
        voiceRoster[idx].category = e.target.value;
      }
    });

    rosterListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="roster-delete"]');
      if (!btn) return;
      const idx = Number.parseInt(btn.dataset.idx, 10);
      if (Number.isNaN(idx) || !voiceRoster[idx]) return;
      const removed = voiceRoster.splice(idx, 1)[0];
      if (removed) purgeRosterIdFromLines(removed.id);
      renderRoster();
      renderBlocks();
    });

    container.querySelector('#add-roster-voice').addEventListener('click', () => {
      voiceRoster.push({
        id: uid(),
        name: `Voz ${voiceRoster.length + 1}`,
        category: 'soprano',
        referenceKey: null,
      });
      renderRoster();
    });

    renderRoster();
  }

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
            ${
              v2Enabled
                ? `<label class="section-block__speed" title="Velocidad de scroll sugerida (F)">
                    <span class="section-block__speed-label">Vel.</span>
                    <input class="section-block__speed-input" type="number" min="0" max="100" placeholder="—" value="${typeof block.speedPreset === 'number' ? block.speedPreset : ''}" data-action="change-speed" data-section="${index}" aria-label="Velocidad de scroll sugerida (0-100)" />
                  </label>`
                : ''
            }
            ${index > 0 ? `<button class="section-block__btn" data-action="move-section-up" data-section="${index}" title="Mover arriba" aria-label="Mover arriba">${icon('chevron-up', { size: 18 })}</button>` : ''}
            ${index < total - 1 ? `<button class="section-block__btn" data-action="move-section-down" data-section="${index}" title="Mover abajo" aria-label="Mover abajo">${icon('chevron-down', { size: 18 })}</button>` : ''}
            <button class="section-block__btn section-block__btn--danger" data-action="delete-section" data-section="${index}" title="Eliminar sección" aria-label="Eliminar sección">${icon('trash', { size: 16 })}</button>
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
    const mainContent = `<input class="line-row__input" type="text" value="${escapeHtml(line.text)}" data-action="edit-text" data-line-id="${line.id}" placeholder="Escribe la línea aquí..." />`;

    return `
      <div class="line-row" data-line-id="${line.id}">
        <div class="line-row__main">
          ${mainContent}
          <div class="line-row__actions">
            ${v2Enabled ? `<button class="line-row__btn line-row__btn--tono" data-action="open-tono" data-line-id="${line.id}" title="Voces y tono" aria-label="Voces y tono">${icon('music', { size: 16 })}</button>` : ''}
            <button class="line-row__btn ${line.chords && line.chords.length > 0 ? 'line-row__btn--active' : ''}" data-action="open-chords" data-line-id="${line.id}" title="Acordes" aria-label="Acordes">${icon('audio-lines', { size: 16 })}</button>
            <button class="line-row__btn ${line.annotation ? 'line-row__btn--active line-row__btn--annotation' : ''}" data-action="toggle-annotation" data-line-id="${line.id}" title="Marcar como anotación/guía" aria-label="Marcar como anotación/guía">${icon('tag', { size: 16 })}</button>
            <button class="line-row__btn line-row__btn--delete" data-action="delete-line" data-line-id="${line.id}" title="Eliminar" aria-label="Eliminar línea">${icon('close', { size: 16 })}</button>
          </div>
        </div>
      </div>
    `;
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
    } else if (action === 'change-label') {
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) {
        blocks[si].label = e.target.value;
        updatePreview();
      }
    } else if (action === 'change-speed') {
      if (!v2Enabled) return;
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) {
        const raw = e.target.value.trim();
        if (raw === '') {
          blocks[si].speedPreset = null;
        } else {
          const n = Number.parseInt(raw, 10);
          blocks[si].speedPreset = Number.isNaN(n) ? null : Math.max(0, Math.min(100, n));
        }
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
    } else if (action === 'open-chords') {
      const found = findLine(btn.dataset.lineId);
      if (found) openChordEditor(found.line);
    } else if (action === 'toggle-annotation') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.line.annotation = !found.line.annotation;
        renderBlocks();
      }
    } else if (action === 'open-tono') {
      if (!v2Enabled) return;
      const found = findLine(btn.dataset.lineId);
      if (found) openTonoEditor(found.line);
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

  // ─── Tono editor por línea (v2, gated): silabación + voz→sílaba + notas ───
  //
  // Modal autocontenido. Muta line.syllables (Task 3) y line.voiceLines (Task 4)
  // directamente sobre el objeto de la línea en `blocks`. La selección de
  // sílabas reusa el modelo tap-anchor-extend del editor de voces, pero a nivel
  // de sílaba en vez de carácter.
  function openTonoEditor(line) {
    line.syllables ??= boundariesToSyllables(line.text || '', []);
    line.voiceLines ??= {};

    // Voz activa (rosterId) + selección de sílabas tap-anchor-extend.
    let activeRosterId = voiceRoster[0]?.id || null;
    const sylSel = { anchor: null, focus: null };

    const overlay = document.createElement('div');
    overlay.className = 'import-modal__overlay';
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      renderBlocks();
      updatePreview();
    }

    /** Cortes internos actuales derivados de las sílabas. */
    function currentBoundaries() {
      return syllablesToBoundaries(line.syllables);
    }

    /**
     * Re-deriva las sílabas desde un set de cortes y RE-MAPEA voiceLines:
     * cambiar la silabación invalida los índices previos, así que se limpia
     * cualquier asignación de voz para evitar punteros colgantes.
     * @param {number[]} boundaries
     */
    function applyBoundaries(boundaries) {
      line.syllables = boundariesToSyllables(line.text || '', boundaries);
      line.voiceLines = {};
      sylSel.anchor = null;
      sylSel.focus = null;
      render();
    }

    function getVoiceLine(rosterId) {
      if (!line.voiceLines[rosterId]) line.voiceLines[rosterId] = { sungSyllables: [], notes: [] };
      return line.voiceLines[rosterId];
    }

    /** Asigna [start..end] (inclusive) como sílabas cantadas de la voz activa. */
    function assignSungRange(start, end) {
      if (!activeRosterId) return;
      const vl = getVoiceLine(activeRosterId);
      const byIdx = new Map();
      vl.sungSyllables.forEach((sIdx, i) => byIdx.set(sIdx, vl.notes[i] ?? null));
      for (let i = start; i <= end; i++) {
        if (!byIdx.has(i)) byIdx.set(i, null);
      }
      const sorted = [...byIdx.keys()].sort((a, b) => a - b);
      vl.sungSyllables = sorted;
      vl.notes = sorted.map((idx) => byIdx.get(idx));
      if (vl.role === undefined) vl.role = 'primary';
    }

    /** Quita una sílaba cantada (y su nota) de la voz activa. */
    function unassignSyllable(sylIdx) {
      if (!activeRosterId) return;
      const vl = line.voiceLines[activeRosterId];
      if (!vl) return;
      const pos = vl.sungSyllables.indexOf(sylIdx);
      if (pos === -1) return;
      vl.sungSyllables.splice(pos, 1);
      vl.notes.splice(pos, 1);
      if (vl.sungSyllables.length === 0) delete line.voiceLines[activeRosterId];
    }

    function noteForSyllable(rosterId, sylIdx) {
      const vl = line.voiceLines[rosterId];
      if (!vl) return undefined;
      const pos = vl.sungSyllables.indexOf(sylIdx);
      return pos === -1 ? undefined : (vl.notes[pos] ?? null);
    }

    function setNoteForSyllable(sylIdx, note) {
      if (!activeRosterId) return;
      const vl = getVoiceLine(activeRosterId);
      const pos = vl.sungSyllables.indexOf(sylIdx);
      if (pos === -1) {
        // No estaba cantada: márcala cantada con esta nota.
        assignSungRange(sylIdx, sylIdx);
        const vl2 = line.voiceLines[activeRosterId];
        const p2 = vl2.sungSyllables.indexOf(sylIdx);
        if (p2 !== -1) vl2.notes[p2] = note;
      } else {
        vl.notes[pos] = note;
      }
    }

    /**
     * Melisma: inserta una sílaba de ancho cero {start:s.end,end:s.end}
     * justo después de la sílaba `sylIdx` (texto vacío). Reindexar voiceLines
     * de TODAS las voces (los índices ≥ insertPos se desplazan +1).
     */
    function addMelismaAfter(sylIdx) {
      const s = line.syllables[sylIdx];
      if (!s) return;
      const insertPos = sylIdx + 1;
      line.syllables.splice(insertPos, 0, { start: s.end, end: s.end });
      for (const vl of Object.values(line.voiceLines)) {
        vl.sungSyllables = vl.sungSyllables.map((idx) => (idx >= insertPos ? idx + 1 : idx));
      }
      // La sílaba extensora la canta la voz activa (con nota a asignar).
      assignSungRange(insertPos, insertPos);
      render();
    }

    function openNotePicker(sylIdx) {
      const current = noteForSyllable(activeRosterId, sylIdx);
      const picker = document.createElement('div');
      picker.className = 'note-picker__overlay';
      picker.innerHTML = `
        <div class="note-picker" role="dialog" aria-label="Elegir nota">
          <div class="note-picker__header">
            <span>Nota de la sílaba</span>
            <button class="note-picker__close" type="button" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
          </div>
          <div class="note-picker__grid">
            <button class="note-picker__note ${current === null || current === undefined ? 'note-picker__note--active' : ''}" data-note="" type="button">Sin nota</button>
            ${NOTE_OPTIONS.map((n) => `<button class="note-picker__note ${current === n ? 'note-picker__note--active' : ''}" data-note="${n}" type="button">${n}</button>`).join('')}
          </div>
        </div>`;
      document.body.appendChild(picker);
      picker.addEventListener('click', (e) => {
        if (e.target === picker || e.target.closest('.note-picker__close')) {
          picker.remove();
          return;
        }
        const noteBtn = e.target.closest('[data-note]');
        if (!noteBtn) return;
        const val = noteBtn.dataset.note;
        setNoteForSyllable(sylIdx, val === '' ? null : val);
        picker.remove();
        render();
      });
    }

    function render() {
      const text = line.text || '';
      const rosterOpts = voiceRoster
        .map(
          (v) =>
            `<option value="${v.id}" ${v.id === activeRosterId ? 'selected' : ''}>${escapeHtml(v.name || getVoiceLabel(v.category))} · ${getVoiceLabel(v.category)}</option>`,
        )
        .join('');

      // Fila de silabación: caracteres con gaps clicables entre ellos.
      const boundaries = currentBoundaries();
      let sylChars = '';
      for (let i = 0; i < text.length; i++) {
        if (i > 0) {
          const active = boundaries.includes(i);
          sylChars += `<button class="syl-gap ${active ? 'syl-gap--active' : ''}" data-gap="${i}" type="button" aria-label="Corte en ${i}">${active ? '|' : ''}</button>`;
        }
        sylChars += `<span class="syl-char">${text[i] === ' ' ? '&nbsp;' : escapeHtml(text[i])}</span>`;
      }
      if (text.length === 0) {
        sylChars = '<span class="syl-char syl-char--empty">(línea vacía)</span>';
      }

      // Tira de sílabas (chips). Estado de selección + nota de la voz activa.
      const a = sylSel.anchor;
      const f = sylSel.focus;
      const rangeStart = a !== null && f !== null ? Math.min(a, f) : a;
      const rangeEnd = a !== null && f !== null ? Math.max(a, f) : a;
      const sylChips = line.syllables
        .map((s, idx) => {
          const sylText = text.slice(s.start, s.end);
          const isMelisma = s.start === s.end;
          const note = activeRosterId ? noteForSyllable(activeRosterId, idx) : undefined;
          const sung = note !== undefined;
          const inRange = rangeStart !== null && idx >= rangeStart && idx <= rangeEnd;
          const cls = [
            'syl-chip',
            sung ? 'syl-chip--sung' : '',
            isMelisma ? 'syl-chip--melisma' : '',
            inRange ? 'syl-chip--in-range' : '',
            a === idx ? 'syl-chip--anchor' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const label = isMelisma ? '~' : escapeHtml(sylText) || '·';
          const noteLabel = sung
            ? `<span class="syl-chip__note">${note === null ? '—' : escapeHtml(note)}</span>`
            : '';
          const melismaBtn =
            sung && !isMelisma
              ? `<button class="syl-chip__melisma" data-melisma="${idx}" type="button" title="Añadir nota sostenida (melisma)" aria-label="Añadir nota sostenida">${icon('plus', { size: 12 })}</button>`
              : '';
          return `<span class="syl-chip-wrap"><button class="${cls}" data-syl="${idx}" type="button">${label}${noteLabel}</button>${melismaBtn}</span>`;
        })
        .join('');

      overlay.innerHTML = `
        <div class="import-modal tono-editor">
          <div class="import-modal__header">
            <h3 class="import-modal__title" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('music', { size: 18 })} Voces y tono</h3>
            <button class="import-modal__close" data-tono="close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head">
              <span>1 · Divide en sílabas (toca entre letras)</span>
              <button class="btn btn--sm" data-tono="autosuggest" type="button">${icon('plus', { size: 14 })} Auto-sugerir</button>
            </div>
            <div class="tono-syllabify">${sylChars}</div>
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head">
              <span>2 · Voz activa</span>
            </div>
            ${
              voiceRoster.length === 0
                ? '<p style="color: var(--color-text-secondary); font-size: 0.85rem;">Añade voces en el roster para asignar sílabas.</p>'
                : `<select class="form-group__input" data-tono="active-voice">${rosterOpts}</select>
            <label class="tono-editor__role">
              <input type="checkbox" data-tono="role-primary" ${activeRosterId && line.voiceLines[activeRosterId]?.role !== 'secondary' ? 'checked' : ''} />
              Voz principal (primary)
            </label>`
            }
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head">
              <span>3 · Marca sílabas cantadas y asigna notas</span>
            </div>
            <p class="tono-editor__hint">Toca una sílaba para iniciar/cerrar un rango. Toca una sílaba cantada de nuevo para elegir su nota.</p>
            <div class="tono-syllables">${sylChips}</div>
          </div>

          <div class="import-modal__actions">
            <button class="btn btn--primary" data-tono="done" type="button">Listo</button>
          </div>
        </div>`;
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        close();
        return;
      }
      const tono = e.target.closest('[data-tono]')?.dataset.tono;
      if (tono === 'close' || tono === 'done') {
        close();
        return;
      }
      if (tono === 'autosuggest') {
        applyBoundaries(autoSuggestBoundaries(line.text || ''));
        return;
      }

      // Toggle de corte de sílaba.
      const gapBtn = e.target.closest('.syl-gap');
      if (gapBtn) {
        const idx = Number.parseInt(gapBtn.dataset.gap, 10);
        if (!Number.isNaN(idx)) {
          applyBoundaries(toggleBoundary(currentBoundaries(), idx, (line.text || '').length));
        }
        return;
      }

      // Selección de sílaba (tap-anchor-extend) + note picker.
      const sylBtn = e.target.closest('.syl-chip');
      if (sylBtn) {
        const idx = Number.parseInt(sylBtn.dataset.syl, 10);
        if (Number.isNaN(idx) || !activeRosterId) return;
        const alreadySung = noteForSyllable(activeRosterId, idx) !== undefined;

        if (sylSel.anchor === null) {
          // Primera pulsación: si ya está cantada, abre el note picker;
          // si no, inicia un rango (anchor).
          if (alreadySung) {
            openNotePicker(idx);
          } else {
            sylSel.anchor = idx;
            sylSel.focus = null;
            render();
          }
          return;
        }

        // Segunda pulsación: cierra el rango [anchor..idx] y lo asigna.
        const start = Math.min(sylSel.anchor, idx);
        const end = Math.max(sylSel.anchor, idx);
        if (start === end && alreadySung) {
          // Misma sílaba ya cantada → desasignar.
          unassignSyllable(idx);
        } else {
          assignSungRange(start, end);
        }
        sylSel.anchor = null;
        sylSel.focus = null;
        render();
        return;
      }

      // Botón melisma dentro de una chip (delegado por data-action separado).
      const melismaBtn = e.target.closest('[data-melisma]');
      if (melismaBtn) {
        const idx = Number.parseInt(melismaBtn.dataset.melisma, 10);
        if (!Number.isNaN(idx)) addMelismaAfter(idx);
      }
    });

    overlay.addEventListener('change', (e) => {
      const tono = e.target.dataset.tono;
      if (tono === 'active-voice') {
        activeRosterId = e.target.value;
        sylSel.anchor = null;
        sylSel.focus = null;
        render();
      } else if (tono === 'role-primary') {
        if (activeRosterId) {
          const vl = getVoiceLine(activeRosterId);
          vl.role = e.target.checked ? 'primary' : 'secondary';
        }
      }
    });

    render();
  }

  /** Popup de acordes por token. Muta line.chords = [{ch,pos}] (pos = carácter). */
  function openChordEditor(line) {
    const overlay = document.createElement('div');
    overlay.className = 'import-modal__overlay';
    document.body.appendChild(overlay);
    let selectedStart = null; // token.start del token en edición

    const close = () => {
      overlay.remove();
      renderBlocks();
    };
    const chordAt = (pos) => (line.chords || []).find((c) => c.pos === pos);
    const setChord = (pos, ch) => {
      if (!Array.isArray(line.chords)) line.chords = [];
      const clean = ch.trim();
      const existing = line.chords.find((c) => c.pos === pos);
      if (!clean) {
        line.chords = line.chords.filter((c) => c.pos !== pos);
      } else if (existing) {
        existing.ch = clean;
      } else {
        line.chords.push({ ch: clean, pos });
      }
      line.chords.sort((a, b) => a.pos - b.pos);
      line.showChords = line.chords.length > 0;
    };

    function render() {
      const tokens = tokenizeLineForChords(line);
      const chips = tokens
        .map((t) => {
          const c = chordAt(t.start);
          const active = t.start === selectedStart ? ' chord-chip--active' : '';
          const chordLabel = c ? `<span class="chord-chip__chord">${escapeHtml(c.ch)}</span>` : '';
          return `<span class="chord-chip-wrap">${chordLabel}<button class="chord-chip${active}" data-token-start="${t.start}" type="button">${escapeHtml(t.text)}</button></span>`;
        })
        .join('');
      const sel = selectedStart === null ? null : chordAt(selectedStart);
      const editor =
        selectedStart === null
          ? `<p class="tono-editor__hint">Tocá un token para poner o editar su acorde.</p>`
          : `<div class="chord-editor__assign">
               <input class="form-group__input" data-chord="input" type="text" value="${escapeHtml(sel?.ch || '')}" placeholder="Ej: Am, F#m, G7" />
               <button class="btn btn--sm" data-chord="apply" type="button">Guardar</button>
               <button class="btn btn--sm btn--secondary" data-chord="clear" type="button">Quitar</button>
             </div>`;
      overlay.innerHTML = `
        <div class="import-modal tono-editor">
          <div class="import-modal__header">
            <h3 class="import-modal__title" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('audio-lines', { size: 18 })} Acordes</h3>
            <button class="import-modal__close" data-chord="close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
          </div>
          <div class="tono-editor__step">
            <div class="tono-syllables chord-tokens">${chips || '<em>Línea vacía</em>'}</div>
          </div>
          <div class="tono-editor__step">${editor}</div>
          <div class="import-modal__actions">
            <button class="btn btn--primary" data-chord="done" type="button">Listo</button>
          </div>
        </div>`;
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close();
      const act = e.target.closest('[data-chord]')?.dataset.chord;
      if (act === 'close' || act === 'done') return close();
      if (act === 'apply') {
        const input = overlay.querySelector('[data-chord="input"]');
        if (input && selectedStart !== null) setChord(selectedStart, input.value);
        selectedStart = null;
        render();
        return;
      }
      if (act === 'clear') {
        if (selectedStart !== null) setChord(selectedStart, '');
        selectedStart = null;
        render();
        return;
      }
      const tokenBtn = e.target.closest('.chord-chip');
      if (tokenBtn) {
        const start = Number.parseInt(tokenBtn.dataset.tokenStart, 10);
        if (!Number.isNaN(start)) {
          selectedStart = start;
          render();
        }
      }
    });

    render();
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
          <h3 class="import-modal__title" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('download', { size: 18 })} Importar texto</h3>
          <button class="import-modal__close" id="import-close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
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
  container
    .querySelector('#editor-cancel')
    .addEventListener('click', () => navigate(from ? '/song/' + from : '/admin'));

  // ─── Delete ───
  if (existingSong) {
    container
      .querySelector('#editor-delete')
      ?.addEventListener('click', () => handleDelete(existingSong));
  }

  // ─── Save ───
  container
    .querySelector('#editor-save')
    .addEventListener('click', () =>
      handleSave(container, existingSong, blocks, voiceLinkItems, { v2Enabled, voiceRoster, from }),
    );
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

/**
 * Destino de navegación tras guardar el editor.
 * @param {{from: string|null, isNew: boolean}} opts
 * @returns {string} ruta hash (sin '#')
 */
export function postSaveTarget({ from, isNew }) {
  if (from) return '/song/' + from;
  return isNew ? '/admin' : '/admin/edit';
}

async function handleSave(container, existingSong, blocks, voiceLinkItems, v2 = {}) {
  const btn = container.querySelector('#editor-save');
  const roster = v2.v2Enabled ? v2.voiceRoster || [] : [];
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  clearSaveError(container);

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

    // ─── v2: sólo cuando hay roster. Si no, el payload queda idéntico a v1. ───
    if (roster.length > 0) {
      newSong.schemaVersion = 2;
      newSong.voiceRoster = roster;
      newSong.sections = blocksToSectionsV2(blocks, newSong.voiceRoster);
      try {
        validateSongV2(newSong);
      } catch (e) {
        showSaveError(container, `No se pudo guardar (tono): ${e.message}`);
        return;
      }
    }

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
    navigate(postSaveTarget({ from: v2.from || null, isNew: !existingSong }));
    showToast('Canción guardada correctamente');
  } catch (err) {
    console.error(err);
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('save', { size: 16 })} Guardar canción`;
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
    showToast('Canción eliminada');
  } catch (e) {
    console.error(e);
    showToast('Error: ' + e.message);
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

/**
 * Show an inline, accessible save error next to the save button. Includes an
 * icon + text (not color-only) and is exposed via role="alert".
 * @param {HTMLElement} container
 * @param {string} message
 */
function showSaveError(container, message) {
  const el = container.querySelector('#editor-save-error');
  if (!el) return;
  el.innerHTML = `${icon('frown', { size: 16 })}<span>${escapeHtml(message)}</span>`;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** @param {HTMLElement} container */
function clearSaveError(container) {
  const el = container.querySelector('#editor-save-error');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
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
